module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::open_interest_tracker {
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::price_management;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market_config;
    use 0x1::math64;
    use 0x1::event;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::clearinghouse_perp;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine;
    enum OpenInterestTracker has key {
        V1 {
            max_open_interest: u64,
            current_open_interest: u64,
            max_notional_open_interest: u64,
            lot_size: u64,
        }
    }
    struct OpenInterestTrackerView has copy, drop {
        max_open_interest: u64,
        current_open_interest: u64,
        max_notional_open_interest: u64,
        lot_size: u64,
    }
    enum OpenInterestUpdateEvent has drop, store {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
            current_open_interest: u64,
        }
    }
    friend fun decrease_max_notional_open_interest(p0: object::Object<perp_market::PerpMarket>, p1: u64)
        acquires OpenInterestTracker
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global_mut<OpenInterestTracker>(_v0);
        let _v2 = *&_v1.max_notional_open_interest;
        assert!(p1 < _v2, 3);
        let _v3 = &mut _v1.max_notional_open_interest;
        *_v3 = p1;
    }
    friend fun decrease_max_open_interest(p0: object::Object<perp_market::PerpMarket>, p1: u64)
        acquires OpenInterestTracker
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global_mut<OpenInterestTracker>(_v0);
        let _v2 = *&_v1.lot_size;
        assert!(p1 % _v2 == 0, 1);
        let _v3 = *&_v1.max_open_interest;
        assert!(p1 < _v3, 3);
        let _v4 = &mut _v1.max_open_interest;
        *_v4 = p1;
    }
    friend fun get_current_open_interest(p0: object::Object<perp_market::PerpMarket>): u64
        acquires OpenInterestTracker
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        *&borrow_global<OpenInterestTracker>(_v0).current_open_interest
    }
    friend fun get_max_notional_open_interest(p0: object::Object<perp_market::PerpMarket>): u64
        acquires OpenInterestTracker
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        *&borrow_global<OpenInterestTracker>(_v0).max_notional_open_interest
    }
    friend fun get_max_open_interest(p0: object::Object<perp_market::PerpMarket>): u64
        acquires OpenInterestTracker
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        *&borrow_global<OpenInterestTracker>(_v0).max_open_interest
    }
    friend fun get_max_open_interest_delta_for_market(p0: object::Object<perp_market::PerpMarket>): u64
        acquires OpenInterestTracker
    {
        let _v0;
        let _v1 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v2 = borrow_global<OpenInterestTracker>(_v1);
        let _v3 = price_management::get_mark_price(p0);
        let _v4 = perp_market_config::get_size_multiplier(p0);
        if (_v3 == 0) _v0 = *&_v2.max_open_interest else {
            let _v5 = (*&_v2.max_notional_open_interest) as u128;
            let _v6 = _v4 as u128;
            let _v7 = _v5 * _v6;
            let _v8 = _v3 as u128;
            let _v9 = _v7 / _v8;
            if (_v9 > 18446744073709551615u128) _v0 = *&_v2.max_open_interest else {
                let _v10 = _v9 as u64;
                let _v11 = *&_v2.lot_size;
                let _v12 = _v10 / _v11;
                let _v13 = *&_v2.lot_size;
                _v3 = _v12 * _v13;
                _v0 = math64::min(*&_v2.max_open_interest, _v3)
            }
        };
        if (*&_v2.current_open_interest >= _v0) return 0;
        let _v14 = *&_v2.current_open_interest;
        _v0 - _v14
    }
    friend fun increase_max_notional_open_interest(p0: object::Object<perp_market::PerpMarket>, p1: u64)
        acquires OpenInterestTracker
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global_mut<OpenInterestTracker>(_v0);
        let _v2 = *&_v1.max_notional_open_interest;
        assert!(p1 > _v2, 2);
        let _v3 = &mut _v1.max_notional_open_interest;
        *_v3 = p1;
    }
    friend fun increase_max_open_interest(p0: object::Object<perp_market::PerpMarket>, p1: u64)
        acquires OpenInterestTracker
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global_mut<OpenInterestTracker>(_v0);
        let _v2 = *&_v1.lot_size;
        assert!(p1 % _v2 == 0, 1);
        let _v3 = *&_v1.max_open_interest;
        assert!(p1 > _v3, 2);
        let _v4 = &mut _v1.max_open_interest;
        *_v4 = p1;
    }
    friend fun mark_open_interest_delta_for_market(p0: object::Object<perp_market::PerpMarket>, p1: i64)
        acquires OpenInterestTracker
    {
        let _v0;
        let _v1;
        let _v2 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v3 = borrow_global_mut<OpenInterestTracker>(_v2);
        if (p1 >= 0i64) {
            _v0 = p1 as u64;
            _v1 = &mut _v3.current_open_interest;
            *_v1 = *_v1 + _v0
        } else {
            _v0 = (-p1) as u64;
            if (*&_v3.current_open_interest >= _v0) {
                _v1 = &mut _v3.current_open_interest;
                *_v1 = *_v1 - _v0
            } else abort 0
        };
        let _v4 = *&_v3.current_open_interest;
        event::emit<OpenInterestUpdateEvent>(OpenInterestUpdateEvent::V1{market: p0, current_open_interest: _v4});
    }
    friend fun register_open_interest_tracker(p0: &signer, p1: u64, p2: u64) {
        assert!(p1 % p2 == 0, 1);
        let _v0 = OpenInterestTracker::V1{max_open_interest: p1, current_open_interest: 0, max_notional_open_interest: 18446744073709551615, lot_size: p2};
        move_to<OpenInterestTracker>(p0, _v0);
    }
    public fun view_available_open_interest(p0: object::Object<perp_market::PerpMarket>): u64
        acquires OpenInterestTracker
    {
        get_max_open_interest_delta_for_market(p0)
    }
    public fun view_open_interest_tracker(p0: object::Object<perp_market::PerpMarket>): OpenInterestTrackerView
        acquires OpenInterestTracker
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global<OpenInterestTracker>(_v0);
        let _v2 = *&_v1.max_open_interest;
        let _v3 = *&_v1.current_open_interest;
        let _v4 = *&_v1.max_notional_open_interest;
        let _v5 = *&_v1.lot_size;
        OpenInterestTrackerView{max_open_interest: _v2, current_open_interest: _v3, max_notional_open_interest: _v4, lot_size: _v5}
    }
}
