module 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::price_management {
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::spread_ema;
    use 0x1::object;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_market;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::decibel_time;
    use 0x1::error;
    use 0x1::math64;
    use 0x1::signer;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_market_config;
    use 0x1::event;
    use 0x1::option;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::pending_order_tracker;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_positions;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::position_update;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::accounts_collateral;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::tp_sl_utils;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::open_interest_tracker;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::clearinghouse_perp;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::liquidation;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::async_matching_engine;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_engine;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::admin_apis;
    enum Price has drop, key {
        V1 {
            last_updated: u64,
            funding_rate_pause_timeout_microseconds: u64,
            oracle_px: u64,
            mark_px: u64,
            withdraw_mark_px: u64,
            size_multiplier: u64,
            accumulative_index: AccumulativeIndex,
            withdraw_accumulative_index: AccumulativeIndex,
            book_mid_px: u64,
            book_mid_30_ema: spread_ema::SpreadEMA,
            oracle_150_spread_ema: spread_ema::SpreadEMA,
            oracle_30_spread_ema: spread_ema::SpreadEMA,
            basis_30_spread_ema: spread_ema::SpreadEMA,
            unrealized_pnl_haircut_bps: u64,
            withdrawable_margin_leverage: u8,
            max_leverage: u8,
        }
    }
    struct AccumulativeIndex has copy, drop, store {
        index: i128,
    }
    enum MarkPriceRefreshInput has drop {
        None,
        UseProvidedImpactHint {
            impact_bid_px: u64,
            impact_ask_px: u64,
        }
    }
    enum PriceIndexStore has key {
        V1 {
            interest_rate: u64,
        }
    }
    enum PriceUpdateEvent has drop, store {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
            oracle_px: u64,
            mark_px: u64,
            impact_ask_px: u64,
            impact_bid_px: u64,
            funding_index: i128,
            funding_rate_bps: i64,
        }
    }
    friend fun accumulative_index(p0: &AccumulativeIndex): i128 {
        *&p0.index
    }
    friend fun register_market(p0: &signer, p1: u64, p2: u64, p3: u8) {
        if (!(p1 > 0)) {
            let _v0 = error::invalid_argument(4);
            abort _v0
        };
        let _v1 = spread_ema::new_ema(30);
        spread_ema::add_observation(&mut _v1, p1, p1);
        let _v2 = decibel_time::now_microseconds();
        let _v3 = AccumulativeIndex{index: 0i128};
        let _v4 = AccumulativeIndex{index: 0i128};
        let _v5 = spread_ema::new_ema(150);
        let _v6 = spread_ema::new_ema(30);
        let _v7 = spread_ema::new_ema(30);
        let _v8 = Price::V1{last_updated: _v2, funding_rate_pause_timeout_microseconds: 360000000, oracle_px: p1, mark_px: p1, withdraw_mark_px: p1, size_multiplier: p2, accumulative_index: _v3, withdraw_accumulative_index: _v4, book_mid_px: p1, book_mid_30_ema: _v1, oracle_150_spread_ema: _v5, oracle_30_spread_ema: _v6, basis_30_spread_ema: _v7, unrealized_pnl_haircut_bps: 0, withdrawable_margin_leverage: p3, max_leverage: p3};
        move_to<Price>(p0, _v8);
    }
    friend fun get_oracle_price(p0: object::Object<perp_market::PerpMarket>): u64
        acquires Price
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        *&borrow_global<Price>(_v0).oracle_px
    }
    friend fun set_max_leverage(p0: object::Object<perp_market::PerpMarket>, p1: u8)
        acquires Price
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = &mut borrow_global_mut<Price>(_v0).max_leverage;
        *_v1 = p1;
    }
    fun calculate_funding_rate(p0: &Price, p1: u64, p2: u64, p3: u64, p4: u64, p5: u64): i64 {
        let _v0;
        let _v1 = *&p0.last_updated;
        let _v2 = p5 - _v1;
        let _v3 = *&p0.funding_rate_pause_timeout_microseconds;
        'l1: loop {
            'l2: loop {
                'l0: loop {
                    loop {
                        if (!(_v2 > _v3)) {
                            let _v4;
                            let _v5;
                            let _v6;
                            let _v7;
                            let _v8;
                            let _v9 = p2 as i64;
                            let _v10 = p1 as i64;
                            let _v11 = _v9 - _v10;
                            let _v12 = p1 as i64;
                            let _v13 = p3 as i64;
                            let _v14 = _v12 - _v13;
                            if (_v11 > 0i64) _v8 = _v11 else _v8 = 0i64;
                            let _v15 = _v14;
                            if (_v15 > 0i64) _v7 = _v15 else _v7 = 0i64;
                            let _v16 = _v8 - _v7;
                            p2 = p1;
                            assert!(p2 != 0, 4);
                            let _v17 = (_v16 as i128) * 1000000i128;
                            let _v18 = p2 as i128;
                            let _v19 = (_v17 / _v18) as i64;
                            let _v20 = (p4 as i64) - _v19;
                            if (_v20 >= 0i64) {
                                _v6 = true;
                                p3 = _v20 as u64
                            } else {
                                _v6 = false;
                                p3 = (-_v20) as u64
                            };
                            let _v21 = math64::min(p3, 500) as i64;
                            if (_v6) _v5 = _v21 else _v5 = -_v21;
                            let _v22 = _v19;
                            _v22 = _v5 + _v22;
                            if (_v22 >= 0i64) {
                                _v4 = true;
                                p5 = _v22 as u64
                            } else {
                                _v4 = false;
                                p5 = (-_v22) as u64
                            };
                            if (p5 > 40000) {
                                if (!_v4) break 'l0;
                                break
                            };
                            _v0 = p5 as i64;
                            if (!_v4) break 'l1;
                            break 'l2
                        };
                        return p4 as i64
                    };
                    return 40000i64
                };
                return -40000i64
            };
            return _v0
        };
        -_v0
    }
    fun calculate_mark_px(p0: u64, p1: u64, p2: u64): u64 {
        ((p1 + p2) / 2 + p0) / 2
    }
    friend fun get_accumulative_index(p0: object::Object<perp_market::PerpMarket>): AccumulativeIndex
        acquires Price
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        *&borrow_global<Price>(_v0).accumulative_index
    }
    friend fun get_book_mid_ema_px(p0: object::Object<perp_market::PerpMarket>): u64
        acquires Price
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global<Price>(_v0);
        let _v2 = &_v1.book_mid_30_ema;
        let _v3 = *&_v1.book_mid_px;
        spread_ema::get_estimated_px(_v2, _v3)
    }
    friend fun get_book_mid_px(p0: object::Object<perp_market::PerpMarket>): u64
        acquires Price
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        *&borrow_global<Price>(_v0).book_mid_px
    }
    friend fun get_funding_cost(p0: &AccumulativeIndex, p1: &AccumulativeIndex, p2: u64, p3: u64, p4: bool): i64 {
        let _v0;
        let _v1;
        let _v2 = *&p1.index;
        let _v3 = *&p0.index;
        let _v4 = _v2 - _v3;
        if (!p4) _v4 = -_v4;
        if (_v4 >= 0i128) {
            p4 = true;
            _v1 = _v4 as u128
        } else {
            p4 = false;
            _v1 = (-_v4) as u128
        };
        let _v5 = p2 as u128;
        let _v6 = _v1 * _v5;
        let _v7 = (p3 as u128) * 1000000u128;
        if (p4) {
            let _v8 = _v6;
            let _v9 = _v7;
            if (_v8 == 0u128) if (_v9 != 0u128) _v0 = 0u128 else {
                let _v10 = error::invalid_argument(4);
                abort _v10
            } else _v0 = (_v8 - 1u128) / _v9 + 1u128
        } else _v0 = _v6 / _v7;
        let _v11 = _v0 as i64;
        if (p4) return _v11;
        -_v11
    }
    friend fun get_mark_and_oracle_price(p0: object::Object<perp_market::PerpMarket>): (u64, u64)
        acquires Price
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global<Price>(_v0);
        let _v2 = *&_v1.mark_px;
        let _v3 = *&_v1.oracle_px;
        (_v2, _v3)
    }
    friend fun get_mark_price(p0: object::Object<perp_market::PerpMarket>): u64
        acquires Price
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        *&borrow_global<Price>(_v0).mark_px
    }
    friend fun get_market_info_for_position_status(p0: object::Object<perp_market::PerpMarket>, p1: bool): (u64, AccumulativeIndex, u64, u64, u8, u8)
        acquires Price
    {
        let _v0;
        let _v1;
        let _v2 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v3 = borrow_global<Price>(_v2);
        if (p1) _v1 = *&_v3.withdraw_mark_px else _v1 = *&_v3.mark_px;
        if (p1) _v0 = *&_v3.withdraw_accumulative_index else _v0 = *&_v3.accumulative_index;
        let _v4 = *&_v3.size_multiplier;
        let _v5 = *&_v3.unrealized_pnl_haircut_bps;
        let _v6 = *&_v3.withdrawable_margin_leverage;
        let _v7 = *&_v3.max_leverage;
        (_v1, _v0, _v4, _v5, _v6, _v7)
    }
    fun get_median_price(p0: u64, p1: u64, p2: u64): u64 {
        'l3: loop {
            'l4: loop {
                'l2: loop {
                    'l0: loop {
                        'l1: loop {
                            loop {
                                if (p0 >= p1) {
                                    if (p1 >= p2) break;
                                    if (!(p0 >= p2)) break 'l0;
                                    break 'l1
                                };
                                if (p0 >= p2) break 'l2;
                                if (!(p1 >= p2)) break 'l3;
                                break 'l4
                            };
                            return p1
                        };
                        return p2
                    };
                    return p0
                };
                return p0
            };
            return p2
        };
        p1
    }
    friend fun get_withdraw_mark_price(p0: object::Object<perp_market::PerpMarket>): u64
        acquires Price
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        *&borrow_global<Price>(_v0).withdraw_mark_px
    }
    friend fun get_withdraw_mark_price_and_funding_index(p0: object::Object<perp_market::PerpMarket>): (u64, AccumulativeIndex)
        acquires Price
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global<Price>(_v0);
        let _v2 = *&_v1.withdraw_mark_px;
        let _v3 = *&_v1.withdraw_accumulative_index;
        (_v2, _v3)
    }
    friend fun new_mark_price_refresh_input_none(): MarkPriceRefreshInput {
        MarkPriceRefreshInput::None{}
    }
    friend fun new_mark_price_refresh_input_with_impact_hint(p0: u64, p1: u64): MarkPriceRefreshInput {
        MarkPriceRefreshInput::UseProvidedImpactHint{impact_bid_px: p0, impact_ask_px: p1}
    }
    friend fun new_price_management(p0: &signer) {
        if (!(signer::address_of(p0) == @0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844)) {
            let _v0 = error::invalid_argument(1);
            abort _v0
        };
        let _v1 = PriceIndexStore::V1{interest_rate: 12};
        move_to<PriceIndexStore>(p0, _v1);
    }
    friend fun override_mark_price(p0: object::Object<perp_market::PerpMarket>, p1: u64)
        acquires Price
    {
        assert!(perp_market_config::is_market_delisted(p0), 3);
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global_mut<Price>(_v0);
        let _v2 = &mut _v1.mark_px;
        *_v2 = p1;
        _v2 = &mut _v1.withdraw_mark_px;
        *_v2 = p1;
        if (!(p1 > 0)) {
            let _v3 = error::invalid_argument(4);
            abort _v3
        };
        let _v4 = *&(&_v1.accumulative_index).index;
        event::emit<PriceUpdateEvent>(PriceUpdateEvent::V1{market: p0, oracle_px: p1, mark_px: p1, impact_ask_px: p1, impact_bid_px: p1, funding_index: _v4, funding_rate_bps: 0i64});
    }
    friend fun set_funding_rate_pause_timeout_microseconds(p0: object::Object<perp_market::PerpMarket>, p1: u64)
        acquires Price
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = &mut borrow_global_mut<Price>(_v0).funding_rate_pause_timeout_microseconds;
        *_v1 = p1;
    }
    friend fun set_interest_rate(p0: &signer, p1: u64)
        acquires PriceIndexStore
    {
        if (!(signer::address_of(p0) == @0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844)) {
            let _v0 = error::invalid_argument(1);
            abort _v0
        };
        let _v1 = &mut borrow_global_mut<PriceIndexStore>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844).interest_rate;
        *_v1 = p1;
    }
    friend fun set_unrealized_pnl_haircut_bps(p0: object::Object<perp_market::PerpMarket>, p1: u64)
        acquires Price
    {
        if (!(p1 < 10000)) {
            let _v0 = error::invalid_argument(256);
            abort _v0
        };
        let _v1 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v2 = &mut borrow_global_mut<Price>(_v1).unrealized_pnl_haircut_bps;
        *_v2 = p1;
    }
    friend fun set_withdrawable_margin_leverage(p0: object::Object<perp_market::PerpMarket>, p1: u8, p2: u8)
        acquires Price
    {
        let _v0;
        if (p1 > 0u8) _v0 = p1 <= p2 else _v0 = false;
        if (!_v0) {
            let _v1 = error::invalid_argument(257);
            abort _v1
        };
        let _v2 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v3 = &mut borrow_global_mut<Price>(_v2).withdrawable_margin_leverage;
        *_v3 = p1;
    }
    friend fun update_accumulative_index(p0: &mut Price, p1: u64, p2: u64, p3: u64, p4: u64, p5: u64): i64 {
        let _v0 = calculate_funding_rate(freeze(p0), p1, p2, p3, p4, p5);
        let _v1 = *&p0.last_updated;
        p2 = p5 - _v1;
        let _v2 = _v0 as i128;
        let _v3 = p2 as i128;
        let _v4 = (_v2 * _v3) as i256;
        let _v5 = p1 as i256;
        let _v6 = (_v4 * _v5 / 3600000000i256) as i128;
        let _v7 = &mut (&mut p0.accumulative_index).index;
        *_v7 = *_v7 + _v6;
        let _v8 = &mut p0.last_updated;
        *_v8 = p5;
        _v8 = &mut p0.oracle_px;
        *_v8 = p1;
        _v0
    }
    fun update_book_mid_price_and_ema(p0: &mut Price, p1: u64) {
        let _v0 = &mut p0.book_mid_30_ema;
        let _v1 = *&p0.book_mid_px;
        spread_ema::add_observation(_v0, p1, _v1);
        let _v2 = &mut p0.book_mid_px;
        *_v2 = p1;
    }
    fun update_mark_px(p0: &mut Price, p1: u64, p2: u64) {
        let _v0 = spread_ema::get_estimated_px(&p0.oracle_150_spread_ema, p1);
        let _v1 = spread_ema::get_estimated_px(&p0.oracle_30_spread_ema, p1);
        let _v2 = spread_ema::get_estimated_px(&p0.basis_30_spread_ema, p2);
        let _v3 = get_median_price(_v0, _v1, _v2);
        let _v4 = &mut p0.mark_px;
        *_v4 = _v3;
        assert!(*&p0.mark_px > 0, 4);
    }
    friend fun update_price(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: MarkPriceRefreshInput): (bool, u64, AccumulativeIndex)
        acquires Price, PriceIndexStore
    {
        let _v0;
        let _v1;
        assert!(perp_market_config::can_update_oracle(p0), 2);
        let _v2 = option::destroy_with_default<u64>(perp_market::best_bid_price(p0), p1);
        let _v3 = option::destroy_with_default<u64>(perp_market::best_ask_price(p0), p1);
        let _v4 = &p2;
        if (_v4 is None) {
            let MarkPriceRefreshInput::None{} = p2;
            _v1 = _v2;
            _v0 = _v3
        } else if (_v4 is UseProvidedImpactHint) {
            let MarkPriceRefreshInput::UseProvidedImpactHint{impact_bid_px: _v5, impact_ask_px: _v6} = p2;
            let _v7 = _v6;
            let _v8 = _v5;
            if (_v8 > _v2) _v1 = _v2 else _v1 = _v8;
            if (_v7 < _v3) _v0 = _v3 else _v0 = _v7
        } else abort 14566554180833181697;
        let (_v9,_v10,_v11) = update_price_internal(p0, p1, _v1, _v0);
        (_v9, _v10, _v11)
    }
    fun update_price_internal(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: u64, p3: u64): (bool, u64, AccumulativeIndex)
        acquires Price, PriceIndexStore
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global_mut<Price>(_v0);
        let _v2 = decibel_time::now_microseconds();
        if (*&_v1.last_updated == _v2) {
            let _v3 = *&_v1.mark_px;
            let _v4 = *&_v1.accumulative_index;
            return (false, _v3, _v4)
        };
        let _v5 = (p2 + p3) / 2;
        update_mark_px(_v1, p1, _v5);
        update_spread_emas(_v1, p1, _v5);
        update_book_mid_price_and_ema(_v1, _v5);
        _v5 = *&borrow_global<PriceIndexStore>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844).interest_rate;
        let _v6 = update_accumulative_index(_v1, p1, p2, p3, _v5, _v2);
        let _v7 = *&_v1.mark_px;
        let _v8 = *&(&_v1.accumulative_index).index;
        event::emit<PriceUpdateEvent>(PriceUpdateEvent::V1{market: p0, oracle_px: p1, mark_px: _v7, impact_ask_px: p3, impact_bid_px: p2, funding_index: _v8, funding_rate_bps: _v6});
        let _v9 = *&_v1.mark_px;
        let _v10 = *&_v1.accumulative_index;
        (true, _v9, _v10)
    }
    fun update_spread_emas(p0: &mut Price, p1: u64, p2: u64) {
        spread_ema::add_observation(&mut p0.oracle_150_spread_ema, p1, p2);
        spread_ema::add_observation(&mut p0.oracle_30_spread_ema, p1, p2);
        let _v0 = &mut p0.basis_30_spread_ema;
        let _v1 = *&p0.mark_px;
        spread_ema::add_observation(_v0, p2, _v1);
    }
    friend fun update_withdraw_mark_px(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: AccumulativeIndex): (u64, AccumulativeIndex, u64, u64, u8)
        acquires Price
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global_mut<Price>(_v0);
        let _v2 = *&_v1.withdraw_mark_px;
        let _v3 = *&_v1.withdraw_accumulative_index;
        let _v4 = &mut _v1.withdraw_mark_px;
        *_v4 = p1;
        let _v5 = &mut _v1.withdraw_accumulative_index;
        *_v5 = p2;
        let _v6 = *&_v1.size_multiplier;
        let _v7 = *&_v1.unrealized_pnl_haircut_bps;
        let _v8 = *&_v1.withdrawable_margin_leverage;
        (_v2, _v3, _v6, _v7, _v8)
    }
}
