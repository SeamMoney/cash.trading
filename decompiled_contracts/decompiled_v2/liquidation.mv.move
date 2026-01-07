module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::liquidation {
    use 0x1::object;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::accounts_collateral;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_positions;
    use 0x1::vector;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::price_management;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market_config;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::backstop_liquidator_profit_tracker;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::clearinghouse_perp;
    use 0x1::option;
    use 0x1::event;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::order_book_types;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine_types;
    use 0x1::string;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::order_placement_utils;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::order_placement;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::adl_tracker;
    use 0x1::debug;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::async_matching_engine;
    struct LiquidationEvent has copy, drop, store {
        market: object::Object<perp_market::PerpMarket>,
        is_isolated: bool,
        user: address,
        type: LiquidationType,
    }
    enum LiquidationType has copy, drop, store {
        MarginCall,
        BackstopLiquidation,
        ADL,
    }
    struct MarginCallResult has drop {
        need_backstop_liquidation: bool,
        fill_limit_exhausted: bool,
    }
    fun backstop_liquidation(p0: address, p1: object::Object<perp_market::PerpMarket>) {
        let _v0 = accounts_collateral::backstop_liquidator();
        assert!(perp_positions::account_initialized(_v0), 3);
        let _v1 = perp_positions::is_position_isolated(p0, p1);
        let _v2 = accounts_collateral::get_user_usdc_balance(p0, p1);
        let _v3 = perp_positions::positions_to_liquidate(p0, p1);
        let _v4 = accounts_collateral::position_status(p0, p1);
        let _v5 = _v3;
        vector::reverse<perp_positions::PerpPosition>(&mut _v5);
        let _v6 = _v5;
        let _v7 = vector::length<perp_positions::PerpPosition>(&_v6);
        'l0: loop {
            'l1: loop {
                loop {
                    if (!(_v7 > 0)) break 'l0;
                    let _v8 = vector::pop_back<perp_positions::PerpPosition>(&mut _v6);
                    let _v9 = perp_positions::get_size(&_v8);
                    if (_v9 != 0) {
                        let _v10 = perp_positions::is_long(&_v8);
                        let _v11 = perp_positions::get_market(&_v8);
                        let _v12 = price_management::get_mark_price(_v11);
                        let _v13 = perp_market_config::round_price_to_ticker(_v11, _v12, !_v10);
                        let _v14 = &_v4;
                        let _v15 = &_v8;
                        let _v16 = perp_positions::calculate_backstop_liquidation_profit(_v2, _v14, _v15);
                        backstop_liquidator_profit_tracker::track_profit(_v11, _v16);
                        let _v17 = clearinghouse_perp::settle_liquidation(_v0, p0, _v11, _v10, _v13, _v9);
                        if (!option::is_some<u64>(&_v17)) break 'l1;
                        if (!(option::destroy_some<u64>(_v17) == _v9)) break;
                        backstop_liquidator_profit_tracker::track_position_update(_v11, _v12, _v9, _v10, false);
                        let _v18 = LiquidationType::BackstopLiquidation{};
                        event::emit<LiquidationEvent>(LiquidationEvent{market: _v11, is_isolated: _v1, user: p0, type: _v18})
                    };
                    _v7 = _v7 - 1;
                    continue
                };
                abort 4
            };
            abort 4
        };
        vector::destroy_empty<perp_positions::PerpPosition>(_v6);
        accounts_collateral::transfer_balance_to_liquidator(_v0, p0, p1);
    }
    friend fun should_trigger_adl(p0: object::Object<perp_market::PerpMarket>): option::Option<u64> {
        let _v0 = perp_market_config::get_adl_trigger_threshold(p0);
        let _v1 = price_management::get_mark_price(p0);
        backstop_liquidator_profit_tracker::should_trigger_adl(p0, _v1, _v0)
    }
    public fun get_ebackstop_liquidator_not_initialized(): u64 {
        3
    }
    public fun get_ecannot_liquidate_backstop_liquidator(): u64 {
        2
    }
    public fun get_ecannot_settle_backstop_liquidation(): u64 {
        4
    }
    public fun get_ecannot_settle_backstop_liquidation_adl(): u64 {
        5
    }
    public fun get_einvalid_adl_liquidation_size(): u64 {
        6
    }
    public fun get_enot_liquidatable(): u64 {
        1
    }
    friend fun liquidate_position_internal(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: &mut u32): bool {
        let _v0 = accounts_collateral::position_status(p1, p0);
        let _v1 = &_v0;
        let _v2 = margin_call(p1, p0, _v1, p2);
        let _v3 = *&(&_v2).fill_limit_exhausted;
        loop {
            if (!_v3) {
                if (!*&(&_v2).need_backstop_liquidation) break;
                backstop_liquidation(p1, p0);
                break
            };
            return true
        };
        false
    }
    fun margin_call(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: &perp_positions::AccountStatusDetailed, p3: &mut u32): MarginCallResult {
        let _v0;
        let _v1;
        let _v2;
        let _v3 = perp_positions::is_account_liquidatable_detailed(p2, false);
        'l1: loop {
            'l0: loop {
                loop {
                    if (_v3) {
                        let _v4 = perp_positions::is_position_isolated(p0, p1);
                        if (perp_positions::is_account_liquidatable_detailed(p2, true)) break;
                        _v2 = perp_positions::positions_to_liquidate(p0, p1);
                        _v1 = 0;
                        loop {
                            let _v5;
                            let _v6 = vector::length<perp_positions::PerpPosition>(&_v2);
                            if (_v1 < _v6) _v5 = *p3 > 0u32 else _v5 = false;
                            if (!_v5) break;
                            let _v7 = *vector::borrow<perp_positions::PerpPosition>(&_v2, _v1);
                            let _v8 = perp_positions::get_size(&_v7);
                            if (_v8 != 0) {
                                _v0 = perp_positions::is_long(&_v7);
                                let _v9 = perp_positions::get_market(&_v7);
                                let _v10 = perp_positions::liquidation_price(&_v7, p2);
                                let _v11 = perp_market_config::round_price_to_ticker(_v9, _v10, !_v0);
                                let _v12 = order_book_types::next_order_id();
                                let _v13 = order_book_types::immediate_or_cancel();
                                let _v14 = option::none<order_book_types::TriggerCondition>();
                                let _v15 = perp_engine_types::new_liquidation_metadata();
                                let _v16 = option::none<string::String>();
                                let (_v17,_v18,_v19,_v20,_v21) = order_placement_utils::place_order_and_trigger_matching_actions(_v9, p0, _v11, _v8, _v8, !_v0, _v13, _v14, _v15, _v12, _v16, true, p3);
                                let _v22 = _v20;
                                let _v23 = _v19;
                                if (vector::length<u64>(&_v22) > 0) {
                                    let _v24 = LiquidationType::MarginCall{};
                                    event::emit<LiquidationEvent>(LiquidationEvent{market: _v9, is_isolated: _v4, user: p0, type: _v24})
                                };
                                if (option::is_some<order_placement::OrderCancellationReason>(&_v23)) _v0 = order_placement::is_fill_limit_violation(option::destroy_some<order_placement::OrderCancellationReason>(_v23)) else _v0 = false;
                                if (_v0) break 'l0
                            };
                            _v1 = _v1 + 1;
                            continue
                        };
                        let _v25 = vector::length<perp_positions::PerpPosition>(&_v2);
                        if (_v1 < _v25) {
                            _v0 = false;
                            break 'l1
                        };
                        _v0 = accounts_collateral::is_position_liquidatable(p0, p1, false);
                        break 'l1
                    };
                    return MarginCallResult{need_backstop_liquidation: false, fill_limit_exhausted: false}
                };
                return MarginCallResult{need_backstop_liquidation: true, fill_limit_exhausted: false}
            };
            return MarginCallResult{need_backstop_liquidation: false, fill_limit_exhausted: true}
        };
        let _v26 = vector::length<perp_positions::PerpPosition>(&_v2);
        MarginCallResult{need_backstop_liquidation: _v0, fill_limit_exhausted: _v1 < _v26}
    }
    friend fun trigger_adl_internal(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: u64, p3: &mut u32): bool {
        let _v0;
        let _v1;
        'l0: loop {
            if (!(p1 == 0)) {
                _v1 = accounts_collateral::backstop_liquidator();
                let _v2 = perp_positions::get_position_is_long(_v1, p0);
                _v0 = 0u32;
                let _v3 = *p3;
                loop {
                    let _v4;
                    let _v5;
                    if (_v0 < _v3) _v5 = p1 > 0 else _v5 = false;
                    if (!_v5) break 'l0;
                    let _v6 = perp_positions::get_position_size(_v1, p0);
                    if (_v6 == 0) break 'l0;
                    let _v7 = price_management::get_mark_price(p0);
                    let _v8 = adl_tracker::get_next_adl_address(p0, !_v2, _v7);
                    _v7 = perp_positions::get_position_size(_v8, p0);
                    if (_v7 == 0) continue;
                    if (_v6 > _v7) _v4 = _v7 else _v4 = _v6;
                    let _v9 = clearinghouse_perp::settle_liquidation(_v8, _v1, p0, _v2, p2, _v4);
                    if (option::is_none<u64>(&_v9)) {
                        let _v10 = string::utf8(vector[65u8, 68u8, 76u8, 32u8, 116u8, 97u8, 114u8, 103u8, 101u8, 116u8, 32u8, 105u8, 115u8, 32u8, 108u8, 105u8, 113u8, 117u8, 105u8, 100u8, 97u8, 116u8, 97u8, 98u8, 108u8, 101u8, 44u8, 32u8, 99u8, 111u8, 110u8, 116u8, 105u8, 110u8, 117u8, 101u8, 32u8, 65u8, 68u8, 76u8]);
                        debug::print<string::String>(&_v10)
                    };
                    backstop_liquidator_profit_tracker::track_position_update(p0, p2, _v4, !_v2, true);
                    let _v11 = LiquidationType::ADL{};
                    event::emit<LiquidationEvent>(LiquidationEvent{market: p0, is_isolated: false, user: _v8, type: _v11});
                    _v0 = _v0 + 1u32;
                    continue
                }
            };
            return false
        };
        let _v12 = perp_positions::get_position_size(_v1, p0);
        *p3 = *p3 - _v0;
        _v12 > 0
    }
}
