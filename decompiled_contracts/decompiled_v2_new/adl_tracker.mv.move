module 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::adl_tracker {
    use 0x1::big_ordered_map;
    use 0x1::object;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_market;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_positions;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::liquidation;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_engine;
    struct ADLKey has copy, drop, store {
        entry_px: u64,
        account: address,
    }
    enum ADLTracker has key {
        V1 {
            long_positions: LeverageBuckets,
            short_positions: LeverageBuckets,
        }
    }
    struct LeverageBuckets has store {
        buckets: vector<big_ordered_map::BigOrderedMap<ADLKey, ADLValue>>,
        cutoffs: vector<u8>,
    }
    struct ADLValue has copy, drop, store {
        leverage: u8,
    }
    friend fun initialize(p0: &signer) {
        let _v0 = new_leverage_buckets_with_cutoffs(vector[1u8, 2u8, 4u8, 8u8, 16u8, 32u8, 64u8]);
        let _v1 = new_leverage_buckets_with_cutoffs(vector[1u8, 2u8, 4u8, 8u8, 16u8, 32u8, 64u8]);
        let _v2 = ADLTracker::V1{long_positions: _v0, short_positions: _v1};
        move_to<ADLTracker>(p0, _v2);
    }
    fun new_leverage_buckets_with_cutoffs(p0: vector<u8>): LeverageBuckets {
        let _v0 = 0x1::vector::length<u8>(&p0);
        let _v1 = 0x1::vector::empty<big_ordered_map::BigOrderedMap<ADLKey, ADLValue>>();
        let _v2 = 0;
        let _v3 = false;
        let _v4 = _v0 + 1;
        loop {
            if (_v3) _v2 = _v2 + 1 else _v3 = true;
            if (!(_v2 < _v4)) break;
            let _v5 = &mut _v1;
            let _v6 = big_ordered_map::new<ADLKey,ADLValue>();
            0x1::vector::push_back<big_ordered_map::BigOrderedMap<ADLKey, ADLValue>>(_v5, _v6);
            continue
        };
        LeverageBuckets{buckets: _v1, cutoffs: p0}
    }
    friend fun add_position(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: bool, p3: u64, p4: u8)
        acquires ADLTracker
    {
        let _v0;
        let _v1 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v2 = borrow_global_mut<ADLTracker>(_v1);
        let _v3 = ADLKey{entry_px: p3, account: p1};
        let _v4 = ADLValue{leverage: p4};
        if (p2) {
            p3 = get_bucket_index(&_v2.long_positions, p4);
            _v0 = 0x1::vector::borrow_mut<big_ordered_map::BigOrderedMap<ADLKey, ADLValue>>(&mut (&mut _v2.long_positions).buckets, p3)
        } else {
            p3 = get_bucket_index(&_v2.short_positions, p4);
            _v0 = 0x1::vector::borrow_mut<big_ordered_map::BigOrderedMap<ADLKey, ADLValue>>(&mut (&mut _v2.short_positions).buckets, p3)
        };
        big_ordered_map::add<ADLKey,ADLValue>(_v0, _v3, _v4);
    }
    fun get_bucket_index(p0: &LeverageBuckets, p1: u8): u64 {
        let _v0 = 0x1::vector::length<u8>(&p0.cutoffs);
        let _v1 = 0;
        let _v2 = false;
        'l1: loop {
            'l0: loop {
                loop {
                    if (_v2) _v1 = _v1 + 1 else _v2 = true;
                    if (!(_v1 < _v0)) break;
                    let _v3 = *0x1::vector::borrow<u8>(&p0.cutoffs, _v1);
                    if (!(p1 <= _v3)) continue;
                    break 'l0
                };
                break 'l1
            };
            return _v1
        };
        _v0
    }
    friend fun get_next_adl_address(p0: object::Object<perp_market::PerpMarket>, p1: bool, p2: u64): address
        acquires ADLTracker
    {
        let _v0;
        let _v1 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v2 = borrow_global<ADLTracker>(_v1);
        if (p1) _v0 = &_v2.long_positions else _v0 = &_v2.short_positions;
        let _v3 = -9223372036854775808i64;
        let _v4 = @0x0;
        let _v5 = false;
        let _v6 = 0x1::vector::length<big_ordered_map::BigOrderedMap<ADLKey, ADLValue>>(&_v0.buckets);
        let _v7 = 0;
        let _v8 = false;
        'l0: loop {
            loop {
                let _v9;
                let _v10;
                let _v11;
                let _v12;
                if (_v8) _v7 = _v7 + 1 else _v8 = true;
                if (!(_v7 < _v6)) break 'l0;
                let _v13 = 0x1::vector::borrow<big_ordered_map::BigOrderedMap<ADLKey, ADLValue>>(&_v0.buckets, _v7);
                if (big_ordered_map::is_empty<ADLKey,ADLValue>(_v13)) continue;
                if (p1) {
                    let (_v14,_v15) = big_ordered_map::borrow_front<ADLKey,ADLValue>(_v13);
                    _v12 = _v15;
                    _v11 = _v14
                } else {
                    let (_v16,_v17) = big_ordered_map::borrow_back<ADLKey,ADLValue>(_v13);
                    _v12 = _v17;
                    _v11 = _v16
                };
                if (p1) {
                    let _v18 = p2 as i64;
                    let _v19 = (*&(&_v11).entry_px) as i64;
                    _v10 = _v18 - _v19
                } else {
                    let _v20 = (*&(&_v11).entry_px) as i64;
                    let _v21 = p2 as i64;
                    _v10 = _v20 - _v21
                };
                let _v22 = ((*&_v12.leverage) as u64) * 1000000;
                let _v23 = *&(&_v11).entry_px;
                if (!(_v23 != 0)) break;
                let _v24 = _v10 as i128;
                let _v25 = _v22 as i128;
                let _v26 = _v24 * _v25;
                let _v27 = _v23 as i128;
                let _v28 = (_v26 / _v27) as i64;
                if (_v5) _v9 = _v28 >= _v3 else _v9 = true;
                if (!_v9) continue;
                _v3 = _v28;
                _v4 = *&(&_v11).account;
                _v5 = true;
                continue
            };
            abort 4
        };
        _v4
    }
    friend fun remove_position(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: bool, p3: u64, p4: u8)
        acquires ADLTracker
    {
        let _v0;
        let _v1 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v2 = borrow_global_mut<ADLTracker>(_v1);
        let _v3 = ADLKey{entry_px: p3, account: p1};
        if (p2) {
            p3 = get_bucket_index(&_v2.long_positions, p4);
            _v0 = 0x1::vector::borrow_mut<big_ordered_map::BigOrderedMap<ADLKey, ADLValue>>(&mut (&mut _v2.long_positions).buckets, p3)
        } else {
            p3 = get_bucket_index(&_v2.short_positions, p4);
            _v0 = 0x1::vector::borrow_mut<big_ordered_map::BigOrderedMap<ADLKey, ADLValue>>(&mut (&mut _v2.short_positions).buckets, p3)
        };
        let _v4 = &_v3;
        let _v5 = big_ordered_map::remove<ADLKey,ADLValue>(_v0, _v4);
    }
}
