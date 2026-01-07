module 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::liquidation {
    use 0x1::object;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_market;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::accounts_collateral;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_positions;
    use 0x1::vector;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::price_management;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_market_config;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::backstop_liquidator_profit_tracker;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::clearinghouse_perp;
    use 0x1::option;
    use 0x1::event;
    use 0x1::cmp;
    use 0x1b3fa27b03773a4265a09b292c5059da10b4ae8a3dbd2972245c7504e89f52e7::order_book_types;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_engine_types;
    use 0x1::string;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::order_placement_utils;
    use 0x1b3fa27b03773a4265a09b292c5059da10b4ae8a3dbd2972245c7504e89f52e7::market_types;
    use 0x1b3fa27b03773a4265a09b292c5059da10b4ae8a3dbd2972245c7504e89f52e7::order_placement;
    use 0x1::error;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::adl_tracker;
    use 0x1::debug;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::async_matching_engine;
    enum LiquidationEvent has copy, drop, store {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
            is_isolated: bool,
            user: address,
            type: LiquidationType,
        }
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
        vector::reverse<perp_positions::PerpPositionWithMarket>(&mut _v5);
        let _v6 = _v5;
        let _v7 = vector::length<perp_positions::PerpPositionWithMarket>(&_v6);
        'l0: loop {
            'l1: loop {
                loop {
                    if (!(_v7 > 0)) break 'l0;
                    let _v8 = vector::pop_back<perp_positions::PerpPositionWithMarket>(&mut _v6);
                    let _v9 = perp_positions::get_perp_position(&_v8);
                    let _v10 = perp_positions::get_market(&_v8);
                    let _v11 = perp_positions::get_size(_v9);
                    if (_v11 != 0) {
                        let _v12 = perp_positions::is_long(_v9);
                        let _v13 = price_management::get_mark_price(_v10);
                        let _v14 = perp_market_config::round_price_to_ticker(_v10, _v13, !_v12);
                        let _v15 = &_v4;
                        let _v16 = perp_positions::calculate_backstop_liquidation_profit(_v2, _v15, _v9, _v10);
                        backstop_liquidator_profit_tracker::track_profit(_v10, _v16);
                        let _v17 = clearinghouse_perp::settle_backstop_liquidation_or_adl(_v0, p0, _v10, _v12, _v14, _v11, false);
                        if (!option::is_some<u64>(&_v17)) break 'l1;
                        if (!(option::destroy_some<u64>(_v17) == _v11)) break;
                        backstop_liquidator_profit_tracker::track_position_update(_v10, _v13, _v11, _v12, false);
                        let _v18 = LiquidationType::BackstopLiquidation{};
                        event::emit<LiquidationEvent>(LiquidationEvent::V1{market: _v10, is_isolated: _v1, user: p0, type: _v18})
                    };
                    _v7 = _v7 - 1;
                    continue
                };
                abort 4
            };
            abort 4
        };
        vector::destroy_empty<perp_positions::PerpPositionWithMarket>(_v6);
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
        let _v0 = margin_call(p1, p0, p2);
        let _v1 = *&(&_v0).fill_limit_exhausted;
        loop {
            if (!_v1) {
                if (!*&(&_v0).need_backstop_liquidation) break;
                backstop_liquidation(p1, p0);
                break
            };
            return true
        };
        false
    }
    fun margin_call(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: &mut u32): MarginCallResult {
        let _v0;
        let _v1;
        let _v2 = accounts_collateral::position_status(p0, p1);
        let _v3 = perp_positions::is_account_liquidatable_detailed(&_v2, false);
        'l10: loop {
            'l8: loop {
                'l9: loop {
                    loop {
                        if (_v3) {
                            let _v4;
                            let _v5 = perp_positions::is_position_isolated(p0, p1);
                            if (perp_positions::is_account_liquidatable_detailed(&_v2, true)) break;
                            let _v6 = perp_positions::positions_to_liquidate(p0, p1);
                            let _v7 = perp_positions::get_liquidation_margin_multiplier_from_detailed_status(&_v2);
                            let _v8 = perp_positions::get_liquidation_margin_divisor_from_detailed_status(&_v2);
                            let _v9 = perp_positions::get_backstop_liquidation_margin_multiplier_from_detailed_status(&_v2);
                            let _v10 = perp_positions::get_backstop_liquidation_margin_divisor_from_detailed_status(&_v2);
                            let _v11 = perp_positions::get_liquidation_margin_from_detailed_status(&_v2);
                            let _v12 = perp_positions::get_account_balance_from_detailed_status(&_v2);
                            let _v13 = perp_market_config::get_slippage_and_margin_call_fee_scale();
                            let _v14 = 0;
                            let _v15 = true;
                            'l0: loop {
                                'l1: loop {
                                    'l2: loop {
                                        'l5: loop {
                                            'l6: loop {
                                                'l7: loop {
                                                    'l3: loop {
                                                        let _v16;
                                                        let _v17 = vector::length<perp_positions::PerpPositionWithMarket>(&_v6);
                                                        if (_v14 < _v17) _v16 = *p2 > 0u32 else _v16 = false;
                                                        if (!_v16) break 'l0;
                                                        if (!(_v12 >= 0i64)) break 'l1;
                                                        let _v18 = vector::borrow<perp_positions::PerpPositionWithMarket>(&_v6, _v14);
                                                        let _v19 = perp_positions::get_perp_position(_v18);
                                                        let _v20 = perp_positions::get_market(_v18);
                                                        let _v21 = perp_positions::get_size(_v19);
                                                        _v15 = true;
                                                        'l4: loop {
                                                            let _v22;
                                                            let _v23;
                                                            if (!(_v21 != 0)) break;
                                                            let _v24 = price_management::get_mark_price(_v20);
                                                            let _v25 = perp_market_config::get_margin_call_fee_pct(_v20);
                                                            let _v26 = perp_market_config::get_max_leverage(_v20);
                                                            let _v27 = _v13 * _v7;
                                                            let _v28 = (_v26 as u64) * _v8;
                                                            let _v29 = _v27 / _v28;
                                                            let _v30 = _v13 * _v9;
                                                            let _v31 = (_v26 as u64) * _v10;
                                                            let _v32 = _v30 / _v31;
                                                            let _v33 = _v25 * _v13;
                                                            let _v34 = perp_market_config::get_slippage_and_margin_call_fee_scale();
                                                            if (_v33 == 0) if (_v34 != 0) _v23 = 0 else break 'l2 else _v23 = (_v33 - 1) / _v34 + 1;
                                                            if (_v32 < _v23) {
                                                                _v14 = _v14 + 1;
                                                                continue 'l3
                                                            };
                                                            _v4 = perp_positions::is_long(_v19);
                                                            let _v35 = _v12 as u128;
                                                            let _v36 = _v29 as u128;
                                                            let _v37 = _v35 * _v36;
                                                            let _v38 = _v11 as u128;
                                                            let _v39 = (_v37 / _v38) as u64;
                                                            if (_v25 > _v39) _v22 = 0 else _v22 = _v39 - _v25;
                                                            let _v40 = 0;
                                                            let _v41 = perp_market_config::get_slippage_pcts(_v20);
                                                            let _v42 = vector::empty<u64>();
                                                            let _v43 = _v41;
                                                            vector::reverse<u64>(&mut _v43);
                                                            let _v44 = _v43;
                                                            let _v45 = vector::length<u64>(&_v44);
                                                            while (_v45 > 0) {
                                                                let _v46 = vector::pop_back<u64>(&mut _v44);
                                                                let _v47 = &_v46;
                                                                let _v48 = &_v22;
                                                                let _v49 = cmp::compare<u64>(_v47, _v48);
                                                                if (cmp::is_lt(&_v49)) vector::push_back<u64>(&mut _v42, _v46);
                                                                _v45 = _v45 - 1;
                                                                continue
                                                            };
                                                            vector::destroy_empty<u64>(_v44);
                                                            let _v50 = _v42;
                                                            vector::push_back<u64>(&mut _v50, _v22);
                                                            loop {
                                                                let _v51;
                                                                let _v52;
                                                                let _v53;
                                                                let _v54;
                                                                let _v55;
                                                                let _v56;
                                                                let _v57 = vector::length<u64>(&_v50);
                                                                if (_v40 < _v57) _v1 = *p2 > 0u32 else _v1 = false;
                                                                if (!_v1) break 'l4;
                                                                _v15 = false;
                                                                _v45 = *vector::borrow<u64>(&_v50, _v40);
                                                                if (_v4) {
                                                                    let _v58 = _v24 as u128;
                                                                    let _v59 = (_v13 - _v45) as u128;
                                                                    let _v60 = _v58 * _v59;
                                                                    let _v61 = _v13 as u128;
                                                                    _v56 = _v60 / _v61
                                                                } else {
                                                                    let _v62 = _v24 as u128;
                                                                    let _v63 = (_v13 + _v45) as u128;
                                                                    _v53 = _v62 * _v63;
                                                                    _v52 = _v13 as u128;
                                                                    if (_v53 == 0u128) if (_v52 != 0u128) _v56 = 0u128 else break 'l5 else _v56 = (_v53 - 1u128) / _v52 + 1u128
                                                                };
                                                                let _v64 = _v56 as u64;
                                                                _v64 = perp_market_config::round_price_to_ticker(_v20, _v64, !_v4);
                                                                if (_v64 > _v24) _v55 = _v64 - _v24 else _v55 = _v24 - _v64;
                                                                let _v65 = _v55 * _v13;
                                                                let _v66 = _v24;
                                                                if (_v65 == 0) if (_v66 != 0) _v54 = 0 else break 'l6 else _v54 = (_v65 - 1) / _v66 + 1;
                                                                let _v67 = _v54 + _v25;
                                                                if (!(_v67 <= _v29)) break 'l7;
                                                                let _v68 = _v20;
                                                                let _v69 = _v21;
                                                                let _v70 = _v12 as u64;
                                                                let _v71 = _v11 - _v70 + 1;
                                                                let _v72 = perp_market_config::get_size_multiplier(_v68);
                                                                let _v73 = _v71 as u128;
                                                                let _v74 = _v72 as u128;
                                                                let _v75 = _v73 * _v74;
                                                                let _v76 = perp_market_config::get_slippage_and_margin_call_fee_scale() as u128;
                                                                _v53 = _v75 * _v76;
                                                                let _v77 = _v24 as u128;
                                                                let _v78 = _v29 as u128;
                                                                let _v79 = _v67 as u128;
                                                                let _v80 = _v78 - _v79;
                                                                _v52 = _v77 * _v80;
                                                                if (_v52 == 0u128) _v51 = _v69 else {
                                                                    let _v81;
                                                                    if (_v53 == 0u128) if (_v52 != 0u128) _v81 = 0u128 else break 'l3 else _v81 = (_v53 - 1u128) / _v52 + 1u128;
                                                                    let _v82 = perp_market_config::get_min_size(_v68) as u128;
                                                                    if (_v81 <= _v82) _v81 = perp_market_config::get_min_size(_v68) as u128;
                                                                    let _v83 = perp_market_config::get_lot_size(_v68) as u128;
                                                                    if (_v81 % _v83 != 0u128) {
                                                                        let _v84 = perp_market_config::get_lot_size(_v68) as u128;
                                                                        let _v85 = _v81 + _v84;
                                                                        let _v86 = perp_market_config::get_lot_size(_v68) as u128;
                                                                        let _v87 = _v81 % _v86;
                                                                        _v81 = _v85 - _v87
                                                                    };
                                                                    let _v88 = _v69 as u128;
                                                                    if (_v81 > _v88) _v51 = _v69 else _v51 = _v81 as u64
                                                                };
                                                                let _v89 = order_book_types::next_order_id();
                                                                let _v90 = order_book_types::immediate_or_cancel();
                                                                let _v91 = option::none<order_book_types::TriggerCondition>();
                                                                let _v92 = perp_engine_types::new_liquidation_metadata();
                                                                let _v93 = option::none<string::String>();
                                                                let (_v94,_v95,_v96,_v97,_v98) = order_placement_utils::place_order_and_trigger_matching_actions(_v20, p0, _v64, _v51, _v51, !_v4, _v90, _v91, _v92, _v89, _v93, true, p2);
                                                                let _v99 = _v97;
                                                                let _v100 = _v96;
                                                                if (vector::length<u64>(&_v99) > 0) {
                                                                    let _v101 = LiquidationType::MarginCall{};
                                                                    event::emit<LiquidationEvent>(LiquidationEvent::V1{market: _v20, is_isolated: _v5, user: p0, type: _v101});
                                                                    _v2 = accounts_collateral::position_status(p0, p1);
                                                                    _v12 = perp_positions::get_account_balance_from_detailed_status(&_v2);
                                                                    _v11 = perp_positions::get_liquidation_margin_from_detailed_status(&_v2);
                                                                    if (!perp_positions::is_account_liquidatable_detailed(&_v2, false)) break 'l8
                                                                };
                                                                if (option::is_some<market_types::OrderCancellationReason>(&_v100)) _v0 = order_placement::is_fill_limit_violation(option::destroy_some<market_types::OrderCancellationReason>(_v100)) else _v0 = false;
                                                                if (_v0) break 'l9;
                                                                _v40 = _v40 + 1;
                                                                let _v102 = vector::length<u64>(&_v50);
                                                                if (!(_v40 >= _v102)) continue;
                                                                _v15 = true;
                                                                continue
                                                            };
                                                            break
                                                        };
                                                        _v14 = _v14 + 1;
                                                        continue
                                                    };
                                                    let _v103 = error::invalid_argument(4);
                                                    abort _v103
                                                };
                                                abort 8
                                            };
                                            let _v104 = error::invalid_argument(4);
                                            abort _v104
                                        };
                                        let _v105 = error::invalid_argument(4);
                                        abort _v105
                                    };
                                    let _v106 = error::invalid_argument(4);
                                    abort _v106
                                };
                                abort 9
                            };
                            let _v107 = vector::length<perp_positions::PerpPositionWithMarket>(&_v6);
                            if (_v14 < _v107) _v4 = _v15 else _v4 = false;
                            if (_v4) _v1 = false else _v1 = accounts_collateral::is_position_liquidatable(p0, p1, false);
                            let _v108 = vector::length<perp_positions::PerpPositionWithMarket>(&_v6);
                            if (_v14 < _v108) {
                                _v0 = true;
                                break 'l10
                            };
                            _v0 = !_v15;
                            break 'l10
                        };
                        return MarginCallResult{need_backstop_liquidation: false, fill_limit_exhausted: false}
                    };
                    return MarginCallResult{need_backstop_liquidation: true, fill_limit_exhausted: false}
                };
                return MarginCallResult{need_backstop_liquidation: false, fill_limit_exhausted: true}
            };
            return MarginCallResult{need_backstop_liquidation: false, fill_limit_exhausted: false}
        };
        MarginCallResult{need_backstop_liquidation: _v1, fill_limit_exhausted: _v0}
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
                    let _v9 = clearinghouse_perp::settle_backstop_liquidation_or_adl(_v8, _v1, p0, _v2, p2, _v4, true);
                    if (option::is_none<u64>(&_v9)) {
                        let _v10 = string::utf8(vector[65u8, 68u8, 76u8, 32u8, 116u8, 97u8, 114u8, 103u8, 101u8, 116u8, 32u8, 105u8, 115u8, 32u8, 108u8, 105u8, 113u8, 117u8, 105u8, 100u8, 97u8, 116u8, 97u8, 98u8, 108u8, 101u8, 44u8, 32u8, 99u8, 111u8, 110u8, 116u8, 105u8, 110u8, 117u8, 101u8, 32u8, 65u8, 68u8, 76u8]);
                        debug::print<string::String>(&_v10)
                    };
                    backstop_liquidator_profit_tracker::track_position_update(p0, p2, _v4, !_v2, true);
                    let _v11 = LiquidationType::ADL{};
                    event::emit<LiquidationEvent>(LiquidationEvent::V1{market: p0, is_isolated: false, user: _v8, type: _v11});
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
