module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::backstop_liquidator_profit_tracker {
    use 0x1::table;
    use 0x1::object;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market;
    use 0x1::signer;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market_config;
    use 0x1::option;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::clearinghouse_perp;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::liquidation;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::async_matching_engine;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine;
    enum BackstopLiquidatorProfitTracker has key {
        V1 {
            market_data: table::Table<object::Object<perp_market::PerpMarket>, MarketTrackingData>,
        }
    }
    struct MarketTrackingData has drop, store {
        realized_pnl: i64,
        realized_pnl_watermark: i64,
        entry_px_times_size_sum: u128,
        liquidation_size: u64,
        is_long: bool,
    }
    public fun initialize(p0: &signer) {
        assert!(signer::address_of(p0) == @0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75, 1);
        let _v0 = BackstopLiquidatorProfitTracker::V1{market_data: table::new<object::Object<perp_market::PerpMarket>,MarketTrackingData>()};
        move_to<BackstopLiquidatorProfitTracker>(p0, _v0);
    }
    fun calculate_pnl(p0: object::Object<perp_market::PerpMarket>, p1: u128, p2: u64, p3: u64, p4: bool): i64 {
        let _v0 = p2 as u128;
        let _v1 = p3 as u128;
        let _v2 = (_v0 * _v1) as i128;
        let _v3 = p1 as i128;
        let _v4 = _v2 - _v3;
        let _v5 = perp_market_config::get_size_multiplier(p0) as i128;
        let _v6 = (_v4 / _v5) as i64;
        if (p4) return _v6;
        -_v6
    }
    fun handle_position_netting(p0: object::Object<perp_market::PerpMarket>, p1: &mut MarketTrackingData, p2: u64, p3: u64) {
        let _v0 = *&p1.entry_px_times_size_sum;
        let _v1 = p3 as u128;
        let _v2 = _v0 * _v1;
        let _v3 = (*&p1.liquidation_size) as u128;
        let _v4 = _v2 / _v3;
        let _v5 = *&p1.is_long;
        let _v6 = calculate_pnl(p0, _v4, p2, p3, _v5);
        let _v7 = &mut p1.realized_pnl;
        *_v7 = *_v7 + _v6;
    }
    friend fun initialize_market(p0: object::Object<perp_market::PerpMarket>)
        acquires BackstopLiquidatorProfitTracker
    {
        assert!(exists<BackstopLiquidatorProfitTracker>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 2);
        let _v0 = &mut borrow_global_mut<BackstopLiquidatorProfitTracker>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).market_data;
        let _v1 = MarketTrackingData{realized_pnl: 0i64, realized_pnl_watermark: 0i64, entry_px_times_size_sum: 0u128, liquidation_size: 0, is_long: false};
        table::add<object::Object<perp_market::PerpMarket>,MarketTrackingData>(_v0, p0, _v1);
    }
    friend fun set_realized_pnl_watermark(p0: object::Object<perp_market::PerpMarket>, p1: i64)
        acquires BackstopLiquidatorProfitTracker
    {
        assert!(exists<BackstopLiquidatorProfitTracker>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 2);
        let _v0 = &mut table::borrow_mut<object::Object<perp_market::PerpMarket>,MarketTrackingData>(&mut borrow_global_mut<BackstopLiquidatorProfitTracker>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).market_data, p0).realized_pnl_watermark;
        *_v0 = p1;
    }
    friend fun should_trigger_adl(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: u64): option::Option<u64>
        acquires BackstopLiquidatorProfitTracker
    {
        let _v0;
        'l2: loop {
            'l1: loop {
                'l0: loop {
                    loop {
                        if (!(p2 == 0)) {
                            let _v1;
                            let _v2;
                            let _v3;
                            assert!(exists<BackstopLiquidatorProfitTracker>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 2);
                            let _v4 = borrow_global<BackstopLiquidatorProfitTracker>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75);
                            if (!table::contains<object::Object<perp_market::PerpMarket>,MarketTrackingData>(&_v4.market_data, p0)) break;
                            let _v5 = table::borrow<object::Object<perp_market::PerpMarket>,MarketTrackingData>(&_v4.market_data, p0);
                            if (*&_v5.liquidation_size == 0) break 'l0;
                            let _v6 = *&_v5.realized_pnl;
                            let _v7 = *&_v5.realized_pnl_watermark;
                            let _v8 = *&_v5.entry_px_times_size_sum;
                            let _v9 = *&_v5.liquidation_size;
                            let _v10 = *&_v5.is_long;
                            let _v11 = calculate_pnl(p0, _v8, p1, _v9, _v10);
                            let _v12 = _v6 - _v7;
                            let _v13 = _v12 + _v11;
                            if (_v13 > 0i64) _v3 = true else _v3 = ((-_v13) as u64) < p2;
                            if (_v3) break 'l1;
                            let _v14 = perp_market_config::get_size_multiplier(p0);
                            if (*&_v5.is_long) _v2 = -1i128 else _v2 = 1i128;
                            let _v15 = p2 as i64;
                            let _v16 = ((_v12 + _v15) as i128) * _v2;
                            let _v17 = _v14 as i128;
                            let _v18 = _v16 * _v17;
                            let _v19 = (*&_v5.entry_px_times_size_sum) as i128;
                            let _v20 = _v18 + _v19;
                            let _v21 = (*&_v5.liquidation_size) as i128;
                            _v11 = (_v20 / _v21) as i64;
                            if (_v11 > 1i64) _v1 = _v11 else _v1 = 1i64;
                            let _v22 = _v1 as u64;
                            if (*&_v5.is_long) {
                                if (p1 > _v22) {
                                    _v0 = p1;
                                    break 'l2
                                };
                                _v0 = _v22;
                                break 'l2
                            };
                            if (p1 < _v22) {
                                _v0 = p1;
                                break 'l2
                            };
                            _v0 = _v22;
                            break 'l2
                        };
                        return option::none<u64>()
                    };
                    return option::none<u64>()
                };
                return option::none<u64>()
            };
            return option::none<u64>()
        };
        option::some<u64>(_v0)
    }
    friend fun track_position_update(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: u64, p3: bool, p4: bool)
        acquires BackstopLiquidatorProfitTracker
    {
        let _v0;
        let _v1;
        let _v2;
        assert!(exists<BackstopLiquidatorProfitTracker>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 2);
        let _v3 = borrow_global_mut<BackstopLiquidatorProfitTracker>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75);
        let _v4 = p1 as u128;
        let _v5 = p2 as u128;
        let _v6 = _v4 * _v5;
        let _v7 = table::borrow_mut<object::Object<perp_market::PerpMarket>,MarketTrackingData>(&mut _v3.market_data, p0);
        if (*&_v7.is_long == p3) _v2 = true else _v2 = *&_v7.liquidation_size == 0;
        'l1: loop {
            let _v8;
            'l0: loop {
                loop {
                    if (_v2) if (!p4) break else {
                        let _v9 = *&_v7.liquidation_size;
                        if (p2 > _v9) break 'l0 else break 'l1
                    };
                    return ()
                };
                let _v10 = &mut _v7.entry_px_times_size_sum;
                *_v10 = *_v10 + _v6;
                _v0 = &mut _v7.liquidation_size;
                *_v0 = *_v0 + p2;
                _v8 = &mut _v7.is_long;
                *_v8 = p3;
                return ()
            };
            _v1 = *&_v7.liquidation_size;
            let _v11 = p2 - _v1;
            handle_position_netting(p0, _v7, p1, _v1);
            let _v12 = p1 as u128;
            let _v13 = _v11 as u128;
            let _v14 = _v12 * _v13;
            let _v15 = &mut _v7.entry_px_times_size_sum;
            *_v15 = _v14;
            _v0 = &mut _v7.liquidation_size;
            *_v0 = _v11;
            _v8 = &mut _v7.is_long;
            *_v8 = p3;
            return ()
        };
        _v1 = *&_v7.liquidation_size - p2;
        handle_position_netting(p0, _v7, p1, p2);
        let _v16 = *&_v7.entry_px_times_size_sum;
        let _v17 = _v1 as u128;
        let _v18 = _v16 * _v17;
        let _v19 = (*&_v7.liquidation_size) as u128;
        let _v20 = _v18 / _v19;
        let _v21 = &mut _v7.entry_px_times_size_sum;
        *_v21 = _v20;
        _v0 = &mut _v7.liquidation_size;
        *_v0 = _v1;
    }
    friend fun track_profit(p0: object::Object<perp_market::PerpMarket>, p1: i64)
        acquires BackstopLiquidatorProfitTracker
    {
        assert!(exists<BackstopLiquidatorProfitTracker>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 2);
        let _v0 = &mut table::borrow_mut<object::Object<perp_market::PerpMarket>,MarketTrackingData>(&mut borrow_global_mut<BackstopLiquidatorProfitTracker>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).market_data, p0).realized_pnl;
        *_v0 = *_v0 + p1;
    }
}
