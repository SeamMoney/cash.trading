module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::liquidation {
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    use 0x1::option;
    use 0x1::big_ordered_map;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market_config;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::price_management;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::backstop_liquidator_profit_tracker;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::work_unit_utils;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::accounts_collateral;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_positions;
    use 0x1::vector;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::clearinghouse_perp;
    use 0x1::event;
    use 0x1::cmp;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::order_book_types;
    use 0x1::string;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_order;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine_types;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::order_placement_utils;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::market_types;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::order_placement;
    use 0x1::error;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::adl_tracker;
    use 0x1::debug;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::async_matching_engine;
    enum LiquidationEvent has copy, drop, store {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
            user: address,
            type: LiquidationType,
        }
    }
    enum LiquidationType has copy, drop, store {
        MarginCall,
        BackstopLiquidation,
        ADL,
    }
    struct MarginCallContinuation has store {
        current_market: option::Option<object::Object<perp_market::PerpMarket>>,
        largest_slippage_tested: u64,
        markets_witnessed: big_ordered_map::BigOrderedMap<object::Object<perp_market::PerpMarket>, bool>,
    }
    struct MarginCallResult has drop {
        need_backstop_liquidation: bool,
        need_continuation: bool,
    }
    friend fun should_trigger_adl(p0: object::Object<perp_market::PerpMarket>): option::Option<u64> {
        let _v0 = perp_market_config::get_adl_trigger_threshold(p0);
        let _v1 = price_management::get_mark_price(p0);
        backstop_liquidator_profit_tracker::should_trigger_adl(p0, _v1, _v0)
    }
    fun backstop_liquidation(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: &mut work_unit_utils::WorkUnit) {
        let _v0 = accounts_collateral::backstop_liquidator();
        assert!(perp_positions::account_initialized(_v0), 3);
        let _v1 = accounts_collateral::get_user_usdc_balance(p0, p1);
        let _v2 = perp_positions::positions_to_liquidate(p0, p1);
        let _v3 = accounts_collateral::position_status(p0, p1);
        let _v4 = vector::length<perp_positions::PerpPositionWithMarket>(&_v2) as u32;
        work_unit_utils::consume_backstop_liquidation_or_adl_work_units(p2, _v4);
        let _v5 = _v2;
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
                        let _v15 = &_v3;
                        let _v16 = perp_positions::calculate_backstop_liquidation_profit(_v1, _v15, _v9, _v10);
                        backstop_liquidator_profit_tracker::track_profit(_v10, _v16);
                        let _v17 = clearinghouse_perp::settle_backstop_liquidation_or_adl(_v0, p0, _v10, _v12, _v14, _v11, false);
                        if (!option::is_some<u64>(&_v17)) break 'l1;
                        if (!(option::destroy_some<u64>(_v17) == _v11)) break;
                        backstop_liquidator_profit_tracker::track_position_update(_v10, _v13, _v11, _v12, false);
                        let _v18 = LiquidationType::BackstopLiquidation{};
                        event::emit<LiquidationEvent>(LiquidationEvent::V1{market: _v10, user: p0, type: _v18})
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
    friend fun default_margin_call_continuation(): MarginCallContinuation {
        let _v0 = option::none<object::Object<perp_market::PerpMarket>>();
        let _v1 = big_ordered_map::new_with_config<object::Object<perp_market::PerpMarket>,bool>(0u16, 0u16, true);
        MarginCallContinuation{current_market: _v0, largest_slippage_tested: 0, markets_witnessed: _v1}
    }
    friend fun destroy_continuation(p0: MarginCallContinuation) {
        let MarginCallContinuation{current_market: _v0, largest_slippage_tested: _v1, markets_witnessed: _v2} = p0;
        let _v3 = _v2;
        while (!big_ordered_map::is_empty<object::Object<perp_market::PerpMarket>,bool>(&_v3)) {
            let (_v4,_v5) = big_ordered_map::pop_front<object::Object<perp_market::PerpMarket>,bool>(&mut _v3);
            continue
        };
        big_ordered_map::destroy_empty<object::Object<perp_market::PerpMarket>,bool>(_v3);
    }
    friend fun get_continuation_current_market(p0: &MarginCallContinuation): option::Option<object::Object<perp_market::PerpMarket>> {
        *&p0.current_market
    }
    friend fun get_continuation_largest_slippage_tested(p0: &MarginCallContinuation): u64 {
        *&p0.largest_slippage_tested
    }
    friend fun get_continuation_markets_witnessed(p0: &MarginCallContinuation): vector<object::Object<perp_market::PerpMarket>> {
        big_ordered_map::keys<object::Object<perp_market::PerpMarket>,bool>(&p0.markets_witnessed)
    }
    public fun get_ebackstop_liquidator_not_initialized(): u64 {
        abort 0
    }
    public fun get_ecannot_liquidate_backstop_liquidator(): u64 {
        abort 0
    }
    public fun get_ecannot_settle_backstop_liquidation(): u64 {
        abort 0
    }
    public fun get_ecannot_settle_backstop_liquidation_adl(): u64 {
        abort 0
    }
    public fun get_einvalid_adl_liquidation_size(): u64 {
        abort 0
    }
    public fun get_enot_liquidatable(): u64 {
        abort 0
    }
    fun margin_call(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: &mut MarginCallContinuation, p3: &mut work_unit_utils::WorkUnit): MarginCallResult {
        let _v0 = perp_positions::has_position(p0, p1);
        'l12: loop {
            'l13: loop {
                let _v1;
                let _v2;
                let _v3;
                let _v4;
                'l11: loop {
                    'l10: loop {
                        'l9: loop {
                            'l0: loop {
                                loop {
                                    if (_v0) {
                                        let _v5;
                                        let _v6;
                                        let _v7 = accounts_collateral::position_status(p0, p1);
                                        if (!perp_positions::is_account_liquidatable_detailed(&_v7, false)) break;
                                        if (perp_positions::is_account_liquidatable_detailed(&_v7, true)) break 'l0;
                                        _v4 = &mut p2.current_market;
                                        _v3 = &mut p2.largest_slippage_tested;
                                        let _v8 = &mut p2.markets_witnessed;
                                        let _v9 = perp_positions::positions_to_liquidate(p0, p1);
                                        let _v10 = perp_positions::get_liquidation_margin_multiplier_from_detailed_status(&_v7);
                                        let _v11 = perp_positions::get_liquidation_margin_divisor_from_detailed_status(&_v7);
                                        let _v12 = perp_positions::get_backstop_liquidation_margin_multiplier_from_detailed_status(&_v7);
                                        let _v13 = perp_positions::get_backstop_liquidation_margin_divisor_from_detailed_status(&_v7);
                                        let _v14 = perp_positions::get_liquidation_margin_from_detailed_status(&_v7);
                                        let _v15 = perp_positions::get_account_balance_from_detailed_status(&_v7);
                                        let _v16 = perp_market_config::get_slippage_and_margin_call_fee_scale();
                                        let _v17 = option::is_some<object::Object<perp_market::PerpMarket>>(freeze(_v4));
                                        if (_v17) {
                                            let _v18 = &_v9;
                                            let _v19 = false;
                                            let _v20 = 0;
                                            let _v21 = 0;
                                            let _v22 = vector::length<perp_positions::PerpPositionWithMarket>(_v18);
                                            'l1: loop {
                                                loop {
                                                    if (!(_v21 < _v22)) break 'l1;
                                                    let _v23 = perp_positions::get_market(vector::borrow<perp_positions::PerpPositionWithMarket>(_v18, _v21));
                                                    let _v24 = *option::borrow<object::Object<perp_market::PerpMarket>>(freeze(_v4));
                                                    if (_v23 == _v24) break;
                                                    _v21 = _v21 + 1;
                                                    continue
                                                };
                                                _v19 = true;
                                                _v20 = _v21;
                                                break
                                            };
                                            _v6 = _v19;
                                            _v5 = _v20
                                        } else {
                                            _v6 = false;
                                            _v5 = 0
                                        };
                                        if (!_v6) {
                                            _v17 = false;
                                            *_v4 = option::none<object::Object<perp_market::PerpMarket>>();
                                            *_v3 = 0
                                        };
                                        'l2: loop {
                                            'l3: loop {
                                                'l4: loop {
                                                    'l5: loop {
                                                        'l6: loop {
                                                            'l7: loop {
                                                                'l8: loop {
                                                                    let _v25;
                                                                    let _v26 = vector::length<perp_positions::PerpPositionWithMarket>(&_v9);
                                                                    if (_v5 < _v26) _v25 = work_unit_utils::has_more_work(freeze(p3)) else _v25 = false;
                                                                    if (!_v25) break 'l2;
                                                                    if (!(_v15 >= 0i64)) break 'l3;
                                                                    let _v27 = vector::borrow<perp_positions::PerpPositionWithMarket>(&_v9, _v5);
                                                                    let _v28 = freeze(_v8);
                                                                    let _v29 = perp_positions::get_market(_v27);
                                                                    let _v30 = &_v29;
                                                                    if (big_ordered_map::contains<object::Object<perp_market::PerpMarket>,bool>(_v28, _v30)) {
                                                                        _v5 = _v5 + 1;
                                                                        continue
                                                                    };
                                                                    let _v31 = perp_positions::get_perp_position(_v27);
                                                                    _v2 = perp_positions::get_market(_v27);
                                                                    let _v32 = perp_positions::get_size(_v31);
                                                                    if (_v32 != 0) {
                                                                        let _v33;
                                                                        let _v34 = price_management::get_mark_price(_v2);
                                                                        let _v35 = perp_market_config::get_margin_call_fee_pct(_v2);
                                                                        let _v36 = perp_market_config::get_max_leverage(_v2);
                                                                        let _v37 = _v16 * _v10;
                                                                        let _v38 = (_v36 as u64) * _v11;
                                                                        let _v39 = _v37 / _v38;
                                                                        let _v40 = _v16 * _v12;
                                                                        let _v41 = (_v36 as u64) * _v13;
                                                                        let _v42 = _v40 / _v41;
                                                                        let _v43 = _v35 * _v16;
                                                                        let _v44 = perp_market_config::get_slippage_and_margin_call_fee_scale();
                                                                        if (_v43 == 0) if (_v44 != 0) _v33 = 0 else break 'l4 else _v33 = (_v43 - 1) / _v44 + 1;
                                                                        if (_v42 < _v33) {
                                                                            _v5 = _v5 + 1;
                                                                            continue
                                                                        } else {
                                                                            let _v45;
                                                                            let _v46;
                                                                            let _v47;
                                                                            let _v48 = perp_positions::is_long(_v31);
                                                                            let _v49 = _v15 as u128;
                                                                            let _v50 = _v39 as u128;
                                                                            let _v51 = _v49 * _v50;
                                                                            let _v52 = _v14 as u128;
                                                                            let _v53 = (_v51 / _v52) as u64;
                                                                            if (_v35 > _v53) _v47 = 0 else _v47 = _v53 - _v35;
                                                                            let _v54 = 0;
                                                                            let _v55 = perp_market_config::get_slippage_pcts(_v2);
                                                                            let _v56 = vector::empty<u64>();
                                                                            let _v57 = _v55;
                                                                            vector::reverse<u64>(&mut _v57);
                                                                            let _v58 = _v57;
                                                                            _v1 = vector::length<u64>(&_v58);
                                                                            while (_v1 > 0) {
                                                                                let _v59 = vector::pop_back<u64>(&mut _v58);
                                                                                let _v60 = &_v59;
                                                                                let _v61 = &_v47;
                                                                                let _v62 = cmp::compare<u64>(_v60, _v61);
                                                                                if (cmp::is_lt(&_v62)) if (_v17) {
                                                                                    let _v63 = cmp::compare<u64>(freeze(_v3), _v60);
                                                                                    _v46 = cmp::is_le(&_v63)
                                                                                } else _v46 = true else _v46 = false;
                                                                                if (_v46) vector::push_back<u64>(&mut _v56, _v59);
                                                                                _v1 = _v1 - 1;
                                                                                continue
                                                                            };
                                                                            vector::destroy_empty<u64>(_v58);
                                                                            let _v64 = _v56;
                                                                            vector::push_back<u64>(&mut _v64, _v47);
                                                                            loop {
                                                                                let _v65;
                                                                                let _v66;
                                                                                let _v67;
                                                                                let _v68;
                                                                                let _v69;
                                                                                let _v70 = vector::length<u64>(&_v64);
                                                                                if (_v54 < _v70) _v46 = work_unit_utils::has_more_work(freeze(p3)) else _v46 = false;
                                                                                if (_v46) _v69 = _v32 > 0 else _v69 = false;
                                                                                if (!_v69) break;
                                                                                _v1 = *vector::borrow<u64>(&_v64, _v54);
                                                                                if (_v48) {
                                                                                    let _v71 = _v34 as u128;
                                                                                    let _v72 = (_v16 - _v1) as u128;
                                                                                    let _v73 = _v71 * _v72;
                                                                                    let _v74 = _v16 as u128;
                                                                                    if (_v73 == 0u128) if (_v74 != 0u128) _v68 = 0u128 else break 'l5 else _v68 = (_v73 - 1u128) / _v74 + 1u128
                                                                                } else {
                                                                                    let _v75 = _v34 as u128;
                                                                                    let _v76 = (_v16 + _v1) as u128;
                                                                                    let _v77 = _v75 * _v76;
                                                                                    let _v78 = _v16 as u128;
                                                                                    _v68 = _v77 / _v78
                                                                                };
                                                                                let _v79 = _v68 as u64;
                                                                                _v79 = perp_market_config::round_price_to_ticker(_v2, _v79, _v48);
                                                                                if (_v79 > _v34) _v67 = _v79 - _v34 else _v67 = _v34 - _v79;
                                                                                let _v80 = _v67 * _v16;
                                                                                let _v81 = _v34;
                                                                                if (_v80 == 0) if (_v81 != 0) _v66 = 0 else break 'l6 else _v66 = (_v80 - 1) / _v81 + 1;
                                                                                let _v82 = _v66 + _v35;
                                                                                if (!(_v82 <= _v39)) break 'l7;
                                                                                let _v83 = _v2;
                                                                                let _v84 = _v32;
                                                                                let _v85 = _v15 as u64;
                                                                                let _v86 = _v14 - _v85 + 1;
                                                                                let _v87 = perp_market_config::get_size_multiplier(_v83);
                                                                                let _v88 = _v86 as u128;
                                                                                let _v89 = _v87 as u128;
                                                                                let _v90 = _v88 * _v89;
                                                                                let _v91 = perp_market_config::get_slippage_and_margin_call_fee_scale() as u128;
                                                                                let _v92 = _v90 * _v91;
                                                                                let _v93 = _v34 as u128;
                                                                                let _v94 = _v39 as u128;
                                                                                let _v95 = _v82 as u128;
                                                                                let _v96 = _v94 - _v95;
                                                                                let _v97 = _v93 * _v96;
                                                                                if (_v97 == 0u128) _v65 = _v84 else {
                                                                                    let _v98;
                                                                                    if (_v92 == 0u128) if (_v97 != 0u128) _v98 = 0u128 else break 'l8 else _v98 = (_v92 - 1u128) / _v97 + 1u128;
                                                                                    let _v99 = perp_market_config::get_min_size(_v83) as u128;
                                                                                    if (_v98 <= _v99) _v98 = perp_market_config::get_min_size(_v83) as u128;
                                                                                    let _v100 = perp_market_config::get_lot_size(_v83) as u128;
                                                                                    if (_v98 % _v100 != 0u128) {
                                                                                        let _v101 = perp_market_config::get_lot_size(_v83) as u128;
                                                                                        let _v102 = _v98 + _v101;
                                                                                        let _v103 = perp_market_config::get_lot_size(_v83) as u128;
                                                                                        let _v104 = _v98 % _v103;
                                                                                        _v98 = _v102 - _v104
                                                                                    };
                                                                                    let _v105 = _v84 as u128;
                                                                                    if (_v98 > _v105) _v65 = _v84 else _v65 = _v98 as u64
                                                                                };
                                                                                let _v106 = order_book_types::next_order_id();
                                                                                let _v107 = order_book_types::immediate_or_cancel();
                                                                                let _v108 = option::none<string::String>();
                                                                                let _v109 = perp_order::new_order_common_args(_v79, _v65, !_v48, _v107, _v108);
                                                                                let _v110 = option::none<order_book_types::TriggerCondition>();
                                                                                let _v111 = perp_order::new_order_extended_args(p0, _v109, _v106, _v110);
                                                                                let _v112 = perp_engine_types::new_liquidation_metadata();
                                                                                let (_v113,_v114,_v115,_v116) = order_placement_utils::place_order_and_trigger_matching_actions(_v2, _v111, _v65, _v112, true, p3);
                                                                                let _v117 = _v115;
                                                                                let _v118 = _v114;
                                                                                if (vector::length<u64>(&_v117) > 0) {
                                                                                    let _v119 = LiquidationType::MarginCall{};
                                                                                    event::emit<LiquidationEvent>(LiquidationEvent::V1{market: _v2, user: p0, type: _v119});
                                                                                    _v7 = accounts_collateral::position_status(p0, p1);
                                                                                    let (_v120,_v121,_v122) = perp_positions::get_position_details_or_default(p0, _v2);
                                                                                    _v32 = _v120;
                                                                                    _v15 = perp_positions::get_account_balance_from_detailed_status(&_v7);
                                                                                    _v14 = perp_positions::get_liquidation_margin_from_detailed_status(&_v7);
                                                                                    if (!perp_positions::is_account_liquidatable_detailed(&_v7, false)) break 'l9;
                                                                                    if (perp_positions::is_account_liquidatable_detailed(&_v7, true)) break 'l10
                                                                                };
                                                                                if (option::is_some<market_types::OrderCancellationReason>(&_v118)) _v45 = order_placement::is_fill_limit_violation(option::destroy_some<market_types::OrderCancellationReason>(_v118)) else _v45 = false;
                                                                                if (_v45) break 'l11;
                                                                                _v54 = _v54 + 1;
                                                                                continue
                                                                            };
                                                                            work_unit_utils::consume_margin_call_one_market_work_units(p3);
                                                                            if (work_unit_utils::has_more_work(freeze(p3))) big_ordered_map::add<object::Object<perp_market::PerpMarket>,bool>(_v8, _v2, true) else {
                                                                                let _v123 = vector::length<u64>(&_v64);
                                                                                if (_v54 >= _v123) _v45 = true else _v45 = _v32 == 0;
                                                                                if (_v45) {
                                                                                    big_ordered_map::add<object::Object<perp_market::PerpMarket>,bool>(_v8, _v2, true);
                                                                                    *_v4 = option::none<object::Object<perp_market::PerpMarket>>();
                                                                                    *_v3 = 0
                                                                                } else {
                                                                                    *_v4 = option::some<object::Object<perp_market::PerpMarket>>(_v2);
                                                                                    *_v3 = *vector::borrow<u64>(&_v64, _v54)
                                                                                }
                                                                            }
                                                                        }
                                                                    };
                                                                    if (_v17) {
                                                                        _v5 = 0;
                                                                        _v17 = false;
                                                                        continue
                                                                    };
                                                                    _v5 = _v5 + 1;
                                                                    continue
                                                                };
                                                                let _v124 = error::invalid_argument(4);
                                                                abort _v124
                                                            };
                                                            abort 8
                                                        };
                                                        let _v125 = error::invalid_argument(4);
                                                        abort _v125
                                                    };
                                                    let _v126 = error::invalid_argument(4);
                                                    abort _v126
                                                };
                                                let _v127 = error::invalid_argument(4);
                                                abort _v127
                                            };
                                            abort 9
                                        };
                                        if (!work_unit_utils::has_more_work(freeze(p3))) break 'l12;
                                        break 'l13
                                    };
                                    work_unit_utils::consume_small_work_units(p3);
                                    return MarginCallResult{need_backstop_liquidation: false, need_continuation: false}
                                };
                                work_unit_utils::consume_position_status_work_units(p3);
                                return MarginCallResult{need_backstop_liquidation: false, need_continuation: false}
                            };
                            work_unit_utils::consume_position_status_work_units(p3);
                            return MarginCallResult{need_backstop_liquidation: true, need_continuation: false}
                        };
                        work_unit_utils::consume_position_status_work_units(p3);
                        return MarginCallResult{need_backstop_liquidation: false, need_continuation: false}
                    };
                    work_unit_utils::consume_position_status_work_units(p3);
                    return MarginCallResult{need_backstop_liquidation: true, need_continuation: false}
                };
                *_v4 = option::some<object::Object<perp_market::PerpMarket>>(_v2);
                *_v3 = _v1;
                return MarginCallResult{need_backstop_liquidation: false, need_continuation: true}
            };
            work_unit_utils::consume_margin_call_overhead_work_units(p3);
            return MarginCallResult{need_backstop_liquidation: false, need_continuation: false}
        };
        MarginCallResult{need_backstop_liquidation: false, need_continuation: true}
    }
    friend fun margin_call_result_needs_backstop_liquidation(p0: &MarginCallResult): bool {
        *&p0.need_backstop_liquidation
    }
    friend fun margin_call_result_uses_continuation(p0: &MarginCallResult): bool {
        *&p0.need_continuation
    }
    friend fun trigger_adl_internal(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: u64, p3: &mut work_unit_utils::WorkUnit): bool {
        let _v0;
        'l1: loop {
            if (!(p1 == 0)) {
                _v0 = accounts_collateral::backstop_liquidator();
                let _v1 = perp_positions::get_position_is_long(_v0, p0);
                let _v2 = 0u32;
                'l0: loop {
                    loop {
                        let _v3;
                        let _v4;
                        if (work_unit_utils::has_more_work(freeze(p3))) _v4 = p1 > 0 else _v4 = false;
                        if (!_v4) break 'l0;
                        let _v5 = perp_positions::get_position_size(_v0, p0);
                        if (_v5 == 0) break;
                        let _v6 = price_management::get_mark_price(p0);
                        let _v7 = adl_tracker::get_next_adl_address(p0, !_v1, _v6);
                        _v6 = perp_positions::get_position_size(_v7, p0);
                        if (_v6 == 0) continue;
                        if (_v5 > _v6) _v3 = _v6 else _v3 = _v5;
                        let _v8 = clearinghouse_perp::settle_backstop_liquidation_or_adl(_v7, _v0, p0, _v1, p2, _v3, true);
                        if (option::is_none<u64>(&_v8)) {
                            let _v9 = string::utf8(vector[65u8, 68u8, 76u8, 32u8, 116u8, 97u8, 114u8, 103u8, 101u8, 116u8, 32u8, 105u8, 115u8, 32u8, 108u8, 105u8, 113u8, 117u8, 105u8, 100u8, 97u8, 116u8, 97u8, 98u8, 108u8, 101u8, 44u8, 32u8, 99u8, 111u8, 110u8, 116u8, 105u8, 110u8, 117u8, 101u8, 32u8, 65u8, 68u8, 76u8]);
                            debug::print<string::String>(&_v9)
                        };
                        backstop_liquidator_profit_tracker::track_position_update(p0, p2, _v3, !_v1, true);
                        let _v10 = LiquidationType::ADL{};
                        event::emit<LiquidationEvent>(LiquidationEvent::V1{market: p0, user: _v7, type: _v10});
                        _v2 = _v2 + 1u32;
                        work_unit_utils::consume_backstop_liquidation_or_adl_work_units(p3, 1u32);
                        continue
                    };
                    break 'l1
                };
                break
            };
            return false
        };
        perp_positions::get_position_size(_v0, p0) > 0
    }
    friend fun trigger_backstop_liquidation_internal(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: &mut work_unit_utils::WorkUnit) {
        backstop_liquidation(p1, p0, p2);
    }
    friend fun trigger_margin_call_internal(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: &mut MarginCallContinuation, p3: &mut work_unit_utils::WorkUnit): MarginCallResult {
        margin_call(p1, p0, p2, p3)
    }
}
