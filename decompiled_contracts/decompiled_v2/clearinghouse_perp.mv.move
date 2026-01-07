module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::clearinghouse_perp {
    use 0x1::object;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::order_book_types;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine_types;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::market_types;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::accounts_collateral;
    use 0x1::string;
    use 0x1::option;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::order_margin;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_positions;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::pending_order_tracker;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market_config;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::open_interest_tracker;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::builder_code_registry;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::position_update;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::fee_distribution;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::backstop_liquidator_profit_tracker;
    use 0x1::error;
    use 0x1::vector;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::price_management;
    use 0x1::math64;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::market_clearinghouse_order_info;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::position_tp_sl;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::tp_sl_utils;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::order_placement_utils;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::liquidation;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::async_matching_engine;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine;
    friend fun place_maker_order(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: order_book_types::OrderIdType, p3: u64, p4: bool, p5: u64, p6: order_book_types::TimeInForce, p7: perp_engine_types::OrderMetadata): market_types::PlaceMakerOrderResult<perp_engine_types::OrderMatchingActions> {
        let _v0;
        let _v1 = accounts_collateral::backstop_liquidator();
        if (p1 == _v1) _v0 = true else {
            let _v2 = order_book_types::immediate_or_cancel();
            _v0 = p6 == _v2
        };
        loop {
            let _v3;
            if (_v0) {
                let _v4 = option::none<string::String>();
                let _v5 = option::none<perp_engine_types::OrderMatchingActions>();
                return market_types::new_place_maker_order_result<perp_engine_types::OrderMatchingActions>(_v4, _v5)
            } else {
                if (perp_engine_types::is_reduce_only(&p7)) _v3 = order_margin::add_reduce_only_order(p1, p0, p2, p5, p4) else {
                    accounts_collateral::add_pending_order(p1, p0, p5, p4, p3);
                    _v3 = vector::empty<perp_engine_types::SingleOrderAction>()
                };
                if (!(vector::length<perp_engine_types::SingleOrderAction>(&_v3) > 0)) break
            };
            let _v6 = option::none<string::String>();
            let _v7 = option::some<perp_engine_types::OrderMatchingActions>(perp_engine_types::new_place_maker_order_actions(_v3));
            return market_types::new_place_maker_order_result<perp_engine_types::OrderMatchingActions>(_v6, _v7)
        };
        let _v8 = option::none<string::String>();
        let _v9 = option::none<perp_engine_types::OrderMatchingActions>();
        market_types::new_place_maker_order_result<perp_engine_types::OrderMatchingActions>(_v8, _v9)
    }
    friend fun cleanup_order(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: order_book_types::OrderIdType, p3: u64, p4: u64, p5: bool, p6: bool, p7: order_book_types::TimeInForce, p8: option::Option<order_book_types::TriggerCondition>, p9: perp_engine_types::OrderMetadata) {
        let _v0;
        if (p6) p6 = true else {
            let _v1 = order_book_types::immediate_or_cancel();
            p6 = p7 == _v1
        };
        if (p6) _v0 = true else _v0 = option::is_some<order_book_types::TriggerCondition>(&p8);
        'l0: loop {
            'l1: loop {
                loop {
                    if (!_v0) {
                        let _v2;
                        let _v3;
                        if (perp_engine_types::is_reduce_only(&p9)) _v3 = false else if (p4 == 0) _v3 = true else {
                            let _v4 = accounts_collateral::backstop_liquidator();
                            _v3 = p1 == _v4
                        };
                        if (_v3) break;
                        if (p4 > 0) {
                            let _v5 = accounts_collateral::backstop_liquidator();
                            _v2 = p1 != _v5
                        } else _v2 = false;
                        if (!_v2) break 'l0;
                        break 'l1
                    };
                    return ()
                };
                return ()
            };
            let (_v6,_v7,_v8) = perp_positions::get_position_details_or_default(p1, p0);
            let _v9 = perp_engine_types::is_reduce_only(&p9);
            pending_order_tracker::remove_pending_order(p1, p0, p2, p4, p3, p5, _v9, _v6, _v7, _v8);
            return ()
        };
    }
    friend fun settle_trade(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: address, p3: order_book_types::OrderIdType, p4: order_book_types::OrderIdType, p5: option::Option<string::String>, p6: option::Option<string::String>, p7: bool, p8: u64, p9: u64, p10: u64, p11: order_book_types::OrderType, p12: perp_engine_types::OrderMetadata, p13: perp_engine_types::OrderMetadata, p14: u128): market_types::SettleTradeResult<perp_engine_types::OrderMatchingActions> {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        if (!(p1 != p2)) {
            let _v4 = error::invalid_argument(13);
            abort _v4
        };
        if (!(p9 > 0)) {
            let _v5 = error::invalid_argument(2);
            abort _v5
        };
        if (!(p8 > 0)) {
            let _v6 = error::invalid_argument(4);
            abort _v6
        };
        let _v7 = perp_market_config::can_settle_order(p0, p2, p1);
        'l5: loop {
            let _v8;
            let _v9;
            'l2: loop {
                let _v10;
                let _v11;
                'l1: loop {
                    'l0: loop {
                        let _v12;
                        loop {
                            if (_v7) {
                                let _v13;
                                let (_v14,_v15,_v16,_v17) = get_reduce_only_settlement_size(p0, p1, p2, p7, p9, p12, p13);
                                _v10 = _v17;
                                _v8 = _v16;
                                _v12 = _v14;
                                if (option::is_some<market_types::SettleTradeResult<perp_engine_types::OrderMatchingActions>>(&_v12)) break;
                                let _v18 = open_interest_tracker::get_max_open_interest_delta_for_market(p0);
                                let _v19 = option::destroy_some<u64>(_v15);
                                let (_v20,_v21,_v22) = get_adjusted_size_for_open_interest_cap(p1, p2, p0, p7, _v19, _v18);
                                let _v23 = _v22;
                                _v18 = _v20;
                                if (_v18 == 0) break 'l0;
                                if (_v23) _v8 = option::some<string::String>(string::utf8(vector[77u8, 97u8, 120u8, 32u8, 111u8, 112u8, 101u8, 110u8, 32u8, 105u8, 110u8, 116u8, 101u8, 114u8, 101u8, 115u8, 116u8, 32u8, 118u8, 105u8, 111u8, 108u8, 97u8, 116u8, 105u8, 111u8, 110u8]));
                                let _v24 = perp_engine_types::get_builder_code_from_metadata(&p12);
                                let _v25 = perp_engine_types::get_builder_code_from_metadata(&p13);
                                let _v26 = perp_engine_types::use_backstop_liquidation_margin(&p12);
                                _v11 = accounts_collateral::validate_position_update_for_settlement(p1, p0, p8, p7, true, _v18, _v24, _v26);
                                if (!position_update::is_update_successful(&_v11)) break 'l1;
                                let _v27 = perp_engine_types::use_backstop_liquidation_margin(&p13);
                                _v9 = accounts_collateral::validate_position_update_for_settlement(p2, p0, p8, !p7, false, _v18, _v25, _v27);
                                if (!position_update::is_update_successful(&_v9)) break 'l2;
                                let _v28 = position_update::unwrap_fee_distribution(&_v11);
                                let _v29 = position_update::unwrap_fee_distribution(&_v9);
                                _v23 = position_update::unwrap_is_closed_or_flipped(&_v11);
                                let _v30 = position_update::unwrap_is_closed_or_flipped(&_v9);
                                let (_v31,_v32,_v33) = accounts_collateral::commit_update_position(option::some<order_book_types::OrderIdType>(p3), p5, p8, p7, _v18, _v24, _v11, p14);
                                let (_v34,_v35,_v36) = accounts_collateral::commit_update_position(option::some<order_book_types::OrderIdType>(p4), p6, p8, !p7, _v18, _v25, _v9, p14);
                                let _v37 = _v36;
                                let _v38 = _v35;
                                let _v39 = _v34;
                                let _v40 = accounts_collateral::backstop_liquidator();
                                if (p2 != _v40) {
                                    if (order_book_types::is_single_order_type(&p11)) {
                                        let _v41 = perp_engine_types::is_reduce_only(&p13);
                                        pending_order_tracker::remove_pending_order(p2, p0, p4, _v18, p10, !p7, _v41, _v39, _v38, _v37)
                                    } else pending_order_tracker::update_position(p2, p0, _v39, _v38, _v37)};
                                if (p1 == _v40) _v13 = true else _v13 = p2 == _v40;
                                if (_v13) {
                                    let _v42;
                                    if (p1 == _v40) _v42 = p7 else _v42 = !p7;
                                    backstop_liquidator_profit_tracker::track_position_update(p0, p8, _v18, _v42, true)
                                };
                                let _v43 = &_v28;
                                let _v44 = &_v29;
                                accounts_collateral::distribute_fees(_v43, _v44);
                                let _v45 = vector::empty<perp_engine_types::SingleOrderAction>();
                                'l3: while (_v23) {
                                    let _v46 = pending_order_tracker::clear_reduce_only_orders(p1, p0);
                                    _v0 = 0;
                                    loop {
                                        let _v47 = vector::length<order_book_types::OrderIdType>(&_v46);
                                        if (!(_v0 < _v47)) break 'l3;
                                        let _v48 = &mut _v45;
                                        let _v49 = *vector::borrow<order_book_types::OrderIdType>(&_v46, _v0);
                                        let _v50 = perp_engine_types::new_cancel_order_action(p1, _v49);
                                        vector::push_back<perp_engine_types::SingleOrderAction>(_v48, _v50);
                                        _v0 = _v0 + 1;
                                        continue
                                    };
                                    break
                                };
                                'l4: while (_v30) {
                                    let _v51 = pending_order_tracker::clear_reduce_only_orders(p2, p0);
                                    _v0 = 0;
                                    loop {
                                        let _v52 = vector::length<order_book_types::OrderIdType>(&_v51);
                                        if (!(_v0 < _v52)) break 'l4;
                                        let _v53 = &mut _v45;
                                        let _v54 = *vector::borrow<order_book_types::OrderIdType>(&_v51, _v0);
                                        let _v55 = perp_engine_types::new_cancel_order_action(p2, _v54);
                                        vector::push_back<perp_engine_types::SingleOrderAction>(_v53, _v55);
                                        _v0 = _v0 + 1;
                                        continue
                                    };
                                    break
                                };
                                let _v56 = &p12;
                                place_child_tp_sl_orders(p0, p1, _v18, _v56);
                                let _v57 = &p13;
                                place_child_tp_sl_orders(p0, p2, _v18, _v57);
                                open_interest_tracker::mark_open_interest_delta_for_market(p0, _v21);
                                _v0 = _v18;
                                _v3 = _v10;
                                _v2 = _v8;
                                if (vector::length<perp_engine_types::SingleOrderAction>(&_v45) == 0) {
                                    _v1 = market_types::new_callback_result_continue_matching<perp_engine_types::OrderMatchingActions>(perp_engine_types::new_settle_trade_actions(vector::empty<perp_engine_types::SingleOrderAction>()));
                                    break 'l5
                                };
                                _v1 = market_types::new_callback_result_stop_matching<perp_engine_types::OrderMatchingActions>(perp_engine_types::new_settle_trade_actions(_v45));
                                break 'l5
                            };
                            let _v58 = option::some<string::String>(string::utf8(vector[77u8, 97u8, 114u8, 107u8, 101u8, 116u8, 32u8, 105u8, 115u8, 32u8, 104u8, 97u8, 108u8, 116u8, 101u8, 100u8]));
                            let _v59 = option::some<string::String>(string::utf8(vector[77u8, 97u8, 114u8, 107u8, 101u8, 116u8, 32u8, 105u8, 115u8, 32u8, 104u8, 97u8, 108u8, 116u8, 101u8, 100u8]));
                            let _v60 = market_types::new_callback_result_continue_matching<perp_engine_types::OrderMatchingActions>(perp_engine_types::new_settle_trade_actions(vector::empty<perp_engine_types::SingleOrderAction>()));
                            return market_types::new_settle_trade_result<perp_engine_types::OrderMatchingActions>(0, _v58, _v59, _v60)
                        };
                        return option::destroy_some<market_types::SettleTradeResult<perp_engine_types::OrderMatchingActions>>(_v12)
                    };
                    let _v61 = option::none<string::String>();
                    let _v62 = option::some<string::String>(string::utf8(vector[77u8, 97u8, 120u8, 32u8, 111u8, 112u8, 101u8, 110u8, 32u8, 105u8, 110u8, 116u8, 101u8, 114u8, 101u8, 115u8, 116u8, 32u8, 118u8, 105u8, 111u8, 108u8, 97u8, 116u8, 105u8, 111u8, 110u8]));
                    let _v63 = market_types::new_callback_result_continue_matching<perp_engine_types::OrderMatchingActions>(perp_engine_types::new_settle_trade_actions(vector::empty<perp_engine_types::SingleOrderAction>()));
                    return market_types::new_settle_trade_result<perp_engine_types::OrderMatchingActions>(0, _v61, _v62, _v63)
                };
                let _v64 = option::some<string::String>(position_update::unwrap_failed_update_reason(&_v11));
                let _v65 = market_types::new_callback_result_continue_matching<perp_engine_types::OrderMatchingActions>(perp_engine_types::new_settle_trade_actions(vector::empty<perp_engine_types::SingleOrderAction>()));
                return market_types::new_settle_trade_result<perp_engine_types::OrderMatchingActions>(0, _v10, _v64, _v65)
            };
            let _v66 = option::some<string::String>(position_update::unwrap_failed_update_reason(&_v9));
            let _v67 = market_types::new_callback_result_continue_matching<perp_engine_types::OrderMatchingActions>(perp_engine_types::new_settle_trade_actions(vector::empty<perp_engine_types::SingleOrderAction>()));
            return market_types::new_settle_trade_result<perp_engine_types::OrderMatchingActions>(0, _v66, _v8, _v67)
        };
        market_types::new_settle_trade_result<perp_engine_types::OrderMatchingActions>(_v0, _v3, _v2, _v1)
    }
    fun get_reduce_only_settlement_size(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: address, p3: bool, p4: u64, p5: perp_engine_types::OrderMetadata, p6: perp_engine_types::OrderMetadata): (option::Option<market_types::SettleTradeResult<perp_engine_types::OrderMatchingActions>>, option::Option<u64>, option::Option<string::String>, option::Option<string::String>) {
        let _v0;
        let _v1;
        let _v2 = option::none<string::String>();
        let _v3 = option::none<string::String>();
        let _v4 = &mut _v2;
        let _v5 = get_settlement_size_and_reason(p0, p1, p3, p4, p5, _v4);
        let _v6 = option::is_none<u64>(&_v5);
        loop {
            if (_v6) {
                let _v7 = option::none<string::String>();
                let _v8 = option::some<string::String>(string::utf8(vector[84u8, 97u8, 107u8, 101u8, 114u8, 32u8, 114u8, 101u8, 100u8, 117u8, 99u8, 101u8, 32u8, 111u8, 110u8, 108u8, 121u8, 32u8, 118u8, 105u8, 111u8, 108u8, 97u8, 116u8, 105u8, 111u8, 110u8]));
                let _v9 = market_types::new_callback_result_continue_matching<perp_engine_types::OrderMatchingActions>(perp_engine_types::new_settle_trade_actions(vector::empty<perp_engine_types::SingleOrderAction>()));
                let _v10 = option::some<market_types::SettleTradeResult<perp_engine_types::OrderMatchingActions>>(market_types::new_settle_trade_result<perp_engine_types::OrderMatchingActions>(0, _v7, _v8, _v9));
                let _v11 = option::none<u64>();
                let _v12 = option::none<string::String>();
                let _v13 = option::none<string::String>();
                return (_v10, _v11, _v12, _v13)
            } else {
                _v1 = option::destroy_some<u64>(_v5);
                let _v14 = &mut _v3;
                _v0 = get_settlement_size_and_reason(p0, p2, !p3, p4, p6, _v14);
                if (!option::is_none<u64>(&_v0)) break
            };
            let _v15 = option::some<string::String>(string::utf8(vector[77u8, 97u8, 107u8, 101u8, 114u8, 32u8, 114u8, 101u8, 100u8, 117u8, 99u8, 101u8, 32u8, 111u8, 110u8, 108u8, 121u8, 32u8, 118u8, 105u8, 111u8, 108u8, 97u8, 116u8, 105u8, 111u8, 110u8]));
            let _v16 = market_types::new_callback_result_continue_matching<perp_engine_types::OrderMatchingActions>(perp_engine_types::new_settle_trade_actions(vector::empty<perp_engine_types::SingleOrderAction>()));
            let _v17 = option::some<market_types::SettleTradeResult<perp_engine_types::OrderMatchingActions>>(market_types::new_settle_trade_result<perp_engine_types::OrderMatchingActions>(0, _v15, _v2, _v16));
            let _v18 = option::none<u64>();
            let _v19 = option::none<string::String>();
            let _v20 = option::none<string::String>();
            return (_v17, _v18, _v19, _v20)
        };
        p4 = option::destroy_some<u64>(_v0);
        p4 = math64::min(_v1, p4);
        let _v21 = option::none<market_types::SettleTradeResult<perp_engine_types::OrderMatchingActions>>();
        let _v22 = option::some<u64>(p4);
        (_v21, _v22, _v2, _v3)
    }
    fun get_adjusted_size_for_open_interest_cap(p0: address, p1: address, p2: object::Object<perp_market::PerpMarket>, p3: bool, p4: u64, p5: u64): (u64, i64, bool) {
        let _v0 = perp_positions::get_open_interest_delta_for_long(p0, p2, p3, p4);
        let _v1 = perp_positions::get_open_interest_delta_for_long(p1, p2, !p3, p4);
        let _v2 = _v0 + _v1;
        'l0: loop {
            let _v3;
            loop {
                if (p4 < p5) return (p4, _v2, false) else {
                    let _v4 = p5 as i64;
                    if (!(_v2 > _v4)) break 'l0;
                    if (!(_v2 >= 0i64)) {
                        let _v5 = error::invalid_argument(10);
                        abort _v5
                    };
                    _v3 = (_v2 as u64) - p5;
                    if (!(_v3 >= p4)) break
                };
                return (0, 0i64, true)
            };
            let _v6 = p4 - _v3;
            let _v7 = p5 as i64;
            return (_v6, _v7, true)
        };
        (p4, _v2, false)
    }
    fun place_child_tp_sl_orders(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: u64, p3: &perp_engine_types::OrderMetadata) {
        let _v0;
        let _v1 = perp_engine_types::get_tp_from_metadata(p3);
        let _v2 = perp_engine_types::get_sl_from_metadata(p3);
        if (option::is_none<perp_engine_types::ChildTpSlOrder>(&_v1)) _v0 = option::is_none<perp_engine_types::ChildTpSlOrder>(&_v2) else _v0 = false;
        'l0: loop {
            'l1: loop {
                loop {
                    if (!_v0) {
                        let _v3;
                        let _v4 = perp_positions::get_position_size(p1, p0);
                        _v4 = math64::min(p2, _v4);
                        if (_v4 == 0) break;
                        let _v5 = perp_engine_types::get_builder_code_from_metadata(p3);
                        if (option::is_some<perp_engine_types::ChildTpSlOrder>(&_v1)) {
                            let (_v6,_v7,_v8) = perp_engine_types::destroy_child_tp_sl_order(option::destroy_some<perp_engine_types::ChildTpSlOrder>(_v1));
                            _v3 = _v6;
                            if (position_tp_sl::validate_tp_sl(p1, p0, _v3, true)) {
                                let _v9 = order_book_types::next_order_id();
                                let _v10 = option::some<u64>(_v4);
                                let _v11 = option::some<order_book_types::OrderIdType>(_v9);
                                let _v12 = tp_sl_utils::place_tp_sl_order_for_position_internal(p0, p1, _v3, _v7, _v10, true, _v11, _v5, false, true);
                            }
                        };
                        if (!option::is_some<perp_engine_types::ChildTpSlOrder>(&_v2)) break 'l0;
                        let (_v13,_v14,_v15) = perp_engine_types::destroy_child_tp_sl_order(option::destroy_some<perp_engine_types::ChildTpSlOrder>(_v2));
                        _v3 = _v13;
                        if (!position_tp_sl::validate_tp_sl(p1, p0, _v3, false)) break 'l1;
                        let _v16 = order_book_types::next_order_id();
                        let _v17 = option::some<u64>(_v4);
                        let _v18 = option::some<order_book_types::OrderIdType>(_v16);
                        let _v19 = tp_sl_utils::place_tp_sl_order_for_position_internal(p0, p1, _v3, _v14, _v17, false, _v18, _v5, false, true);
                        break 'l1
                    };
                    return ()
                };
                return ()
            };
            return ()
        };
    }
    friend fun validate_bulk_order_placement(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: &vector<u64>, p3: &vector<u64>, p4: &vector<u64>, p5: &vector<u64>): market_types::ValidationResult {
        perp_market_config::validate_array_of_price_and_size(p0, p2, p3);
        perp_market_config::validate_array_of_price_and_size(p0, p4, p5);
        let _v0 = accounts_collateral::backstop_liquidator();
        'l0: loop {
            let _v1;
            'l1: loop {
                let _v2;
                loop {
                    if (!(p1 == _v0)) {
                        if (!vector::is_empty<u64>(p2)) {
                            let (_v3,_v4) = get_effective_price_and_size(p2, p3);
                            _v2 = accounts_collateral::validate_order_placement(p1, p0, _v4, true, _v3);
                            if (option::is_some<string::String>(&_v2)) break
                        };
                        if (vector::is_empty<u64>(p4)) break 'l0;
                        let (_v5,_v6) = get_effective_price_and_size(p4, p5);
                        _v1 = accounts_collateral::validate_order_placement(p1, p0, _v6, false, _v5);
                        if (!option::is_some<string::String>(&_v1)) break 'l0;
                        break 'l1
                    };
                    return market_types::new_validation_result(option::none<string::String>())
                };
                return market_types::new_validation_result(_v2)
            };
            return market_types::new_validation_result(_v1)
        };
        market_types::new_validation_result(option::none<string::String>())
    }
    fun get_effective_price_and_size(p0: &vector<u64>, p1: &vector<u64>): (u64, u64) {
        let _v0 = vector::length<u64>(p1);
        let _v1 = vector::length<u64>(p0);
        if (!(_v0 == _v1)) {
            let _v2 = error::invalid_argument(1);
            abort _v2
        };
        let _v3 = 0;
        let _v4 = 0u128;
        let _v5 = 0u128;
        loop {
            let _v6 = vector::length<u64>(p0);
            if (!(_v3 < _v6)) break;
            let _v7 = (*vector::borrow<u64>(p1, _v3)) as u128;
            let _v8 = ((*vector::borrow<u64>(p0, _v3)) as u128) * _v7;
            _v4 = _v4 + _v8;
            _v5 = _v5 + _v7;
            _v3 = _v3 + 1;
            continue
        };
        _v4 = _v4 / _v5;
        if (!(_v4 <= 9223372036854775807u128)) {
            let _v9 = error::invalid_argument(5);
            abort _v9
        };
        if (!(_v5 <= 9223372036854775807u128)) {
            let _v10 = error::invalid_argument(3);
            abort _v10
        };
        let _v11 = _v4 as u64;
        let _v12 = _v5 as u64;
        (_v11, _v12)
    }
    friend fun validate_order_placement(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: bool, p3: u64, p4: u64, p5: order_book_types::TimeInForce, p6: perp_engine_types::OrderMetadata): market_types::ValidationResult {
        let _v0;
        let _v1 = perp_market_config::can_place_order(p0, p1);
        'l0: loop {
            loop {
                if (_v1) {
                    let _v2;
                    let _v3 = accounts_collateral::backstop_liquidator();
                    if (p1 == _v3) _v2 = true else {
                        let _v4 = order_book_types::immediate_or_cancel();
                        _v2 = p5 == _v4
                    };
                    if (_v2) break;
                    if (perp_engine_types::is_reduce_only(&p6)) {
                        _v0 = order_margin::validate_reduce_only_order(p1, p0, p2);
                        break 'l0
                    };
                    _v0 = accounts_collateral::validate_order_placement(p1, p0, p4, p2, p3);
                    break 'l0
                };
                return market_types::new_validation_result(option::some<string::String>(string::utf8(vector[77u8, 97u8, 114u8, 107u8, 101u8, 116u8, 32u8, 105u8, 115u8, 32u8, 104u8, 97u8, 108u8, 116u8, 101u8, 100u8])))
            };
            return market_types::new_validation_result(option::none<string::String>())
        };
        market_types::new_validation_result(_v0)
    }
    friend fun close_delisted_position(p0: address, p1: object::Object<perp_market::PerpMarket>) {
        let _v0;
        let _v1;
        let (_v2,_v3) = perp_positions::get_position_size_and_is_long(p0, p1);
        let _v4 = _v3;
        let _v5 = _v2;
        loop {
            if (!(_v5 == 0)) {
                _v1 = price_management::get_mark_price(p1);
                _v0 = accounts_collateral::validate_liquidation_position_update(p0, p1, _v1, !_v4, false, _v5);
                if (position_update::is_update_successful(&_v0)) break;
                abort 8
            };
            return ()
        };
        let _v6 = accounts_collateral::backstop_liquidator();
        let (_v7,_v8,_v9) = accounts_collateral::commit_update_position_with_backstop_liquidator(_v1, !_v4, _v5, _v0, _v6);
    }
    fun get_settlement_size_and_reason(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: bool, p3: u64, p4: perp_engine_types::OrderMetadata, p5: &mut option::Option<string::String>): option::Option<u64> {
        let _v0;
        let _v1 = max_settlement_size<perp_engine_types::OrderMetadata>(p0, p1, p2, p3, p4);
        let _v2 = option::is_none<u64>(&_v1);
        loop {
            if (!_v2) {
                _v0 = option::destroy_some<u64>(_v1);
                if (_v0 != p3) {
                    *p5 = option::some<string::String>(string::utf8(vector[84u8, 97u8, 107u8, 101u8, 114u8, 32u8, 114u8, 101u8, 100u8, 117u8, 99u8, 101u8, 32u8, 111u8, 110u8, 108u8, 121u8, 32u8, 118u8, 105u8, 111u8, 108u8, 97u8, 116u8, 105u8, 111u8, 110u8]));
                    break
                };
                break
            };
            return option::none<u64>()
        };
        option::some<u64>(_v0)
    }
    friend fun max_settlement_size<T0: copy + drop + store>(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: bool, p3: u64, p4: perp_engine_types::OrderMetadata): option::Option<u64> {
        let _v0;
        let _v1;
        if (perp_engine_types::is_reduce_only(&p4)) _v1 = false else _v1 = !perp_market_config::is_reduce_only(p0, p1);
        loop {
            if (_v1) return option::some<u64>(p3) else {
                _v0 = accounts_collateral::validate_reduce_only_update(p1, p0, p2, p3);
                if (!position_update::is_reduce_only_violation(&_v0)) break
            };
            return option::none<u64>()
        };
        option::some<u64>(position_update::get_reduce_only_size(&_v0))
    }
    friend fun market_callbacks(p0: object::Object<perp_market::PerpMarket>): market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions> {
        let _v0: |&mut market_types::Market<perp_engine_types::OrderMetadata>, market_clearinghouse_order_info::MarketClearinghouseOrderInfo<perp_engine_types::OrderMetadata>, market_clearinghouse_order_info::MarketClearinghouseOrderInfo<perp_engine_types::OrderMetadata>, u128, u64, u64|market_types::SettleTradeResult<perp_engine_types::OrderMatchingActions> has copy + drop = |arg0,arg1,arg2,arg3,arg4,arg5| lambda__1__market_callbacks(p0, arg0, arg1, arg2, arg3, arg4, arg5);
        let _v1: |market_clearinghouse_order_info::MarketClearinghouseOrderInfo<perp_engine_types::OrderMetadata>, u64|market_types::ValidationResult has copy + drop = |arg0,arg1| lambda__2__market_callbacks(p0, arg0, arg1);
        let _v2: |address, &vector<u64>, &vector<u64>, &vector<u64>, &vector<u64>, &perp_engine_types::OrderMetadata|market_types::ValidationResult has copy + drop = |arg0,arg1,arg2,arg3,arg4,arg5| lambda__3__market_callbacks(p0, arg0, arg1, arg2, arg3, arg4, arg5);
        let _v3: |market_clearinghouse_order_info::MarketClearinghouseOrderInfo<perp_engine_types::OrderMetadata>, u64|market_types::PlaceMakerOrderResult<perp_engine_types::OrderMatchingActions> has copy + drop = |arg0,arg1| lambda__4__market_callbacks(p0, arg0, arg1);
        let _v4: |market_clearinghouse_order_info::MarketClearinghouseOrderInfo<perp_engine_types::OrderMetadata>, u64, bool| has copy + drop = |arg0,arg1,arg2| lambda__5__market_callbacks(p0, arg0, arg1, arg2);
        let _v5: |address, order_book_types::OrderIdType, bool, u64, u64| has copy + drop = |arg0,arg1,arg2,arg3,arg4| lambda__6__market_callbacks(arg0, arg1, arg2, arg3, arg4);
        let _v6: |market_clearinghouse_order_info::MarketClearinghouseOrderInfo<perp_engine_types::OrderMetadata>, u64| has copy + drop = |arg0,arg1| lambda__7__market_callbacks(p0, arg0, arg1);
        let _v7: |&perp_engine_types::OrderMetadata|vector<u8> has copy + drop = |arg0| perp_engine_types::get_order_metadata_bytes(arg0);
        market_types::new_market_clearinghouse_callbacks<perp_engine_types::OrderMetadata,perp_engine_types::OrderMatchingActions>(_v0, _v1, _v2, _v3, _v4, _v5, _v6, _v7)
    }
    fun lambda__1__market_callbacks(p0: object::Object<perp_market::PerpMarket>, p1: &mut market_types::Market<perp_engine_types::OrderMetadata>, p2: market_clearinghouse_order_info::MarketClearinghouseOrderInfo<perp_engine_types::OrderMetadata>, p3: market_clearinghouse_order_info::MarketClearinghouseOrderInfo<perp_engine_types::OrderMetadata>, p4: u128, p5: u64, p6: u64): market_types::SettleTradeResult<perp_engine_types::OrderMatchingActions> {
        let (_v0,_v1,_v2,_v3,_v4,_v5,_v6,_v7,_v8) = market_clearinghouse_order_info::into_inner<perp_engine_types::OrderMetadata>(p2);
        let (_v9,_v10,_v11,_v12,_v13,_v14,_v15,_v16,_v17) = market_clearinghouse_order_info::into_inner<perp_engine_types::OrderMetadata>(p3);
        settle_trade(p0, _v0, _v9, _v1, _v10, _v2, _v11, _v3, p5, p6, _v13, _v15, _v8, _v17, p4)
    }
    fun lambda__2__market_callbacks(p0: object::Object<perp_market::PerpMarket>, p1: market_clearinghouse_order_info::MarketClearinghouseOrderInfo<perp_engine_types::OrderMetadata>, p2: u64): market_types::ValidationResult {
        let (_v0,_v1,_v2,_v3,_v4,_v5,_v6,_v7,_v8) = market_clearinghouse_order_info::into_inner<perp_engine_types::OrderMetadata>(p1);
        validate_order_placement(p0, _v0, _v3, _v4, p2, _v5, _v8)
    }
    fun lambda__3__market_callbacks(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: &vector<u64>, p3: &vector<u64>, p4: &vector<u64>, p5: &vector<u64>, p6: &perp_engine_types::OrderMetadata): market_types::ValidationResult {
        validate_bulk_order_placement(p0, p1, p2, p3, p4, p5)
    }
    fun lambda__4__market_callbacks(p0: object::Object<perp_market::PerpMarket>, p1: market_clearinghouse_order_info::MarketClearinghouseOrderInfo<perp_engine_types::OrderMetadata>, p2: u64): market_types::PlaceMakerOrderResult<perp_engine_types::OrderMatchingActions> {
        let (_v0,_v1,_v2,_v3,_v4,_v5,_v6,_v7,_v8) = market_clearinghouse_order_info::into_inner<perp_engine_types::OrderMetadata>(p1);
        place_maker_order(p0, _v0, _v1, _v4, _v3, p2, _v5, _v8)
    }
    fun lambda__5__market_callbacks(p0: object::Object<perp_market::PerpMarket>, p1: market_clearinghouse_order_info::MarketClearinghouseOrderInfo<perp_engine_types::OrderMetadata>, p2: u64, p3: bool) {
        let (_v0,_v1,_v2,_v3,_v4,_v5,_v6,_v7,_v8) = market_clearinghouse_order_info::into_inner<perp_engine_types::OrderMetadata>(p1);
        cleanup_order(p0, _v0, _v1, _v4, p2, _v3, p3, _v5, _v7, _v8);
    }
    fun lambda__6__market_callbacks(p0: address, p1: order_book_types::OrderIdType, p2: bool, p3: u64, p4: u64) {
        ()
    }
    fun lambda__7__market_callbacks(p0: object::Object<perp_market::PerpMarket>, p1: market_clearinghouse_order_info::MarketClearinghouseOrderInfo<perp_engine_types::OrderMetadata>, p2: u64) {
        let (_v0,_v1,_v2,_v3,_v4,_v5,_v6,_v7,_v8) = market_clearinghouse_order_info::into_inner<perp_engine_types::OrderMetadata>(p1);
        reduce_order_size(p0, _v0, _v1, _v8, p2);
    }
    friend fun reduce_order_size(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: order_book_types::OrderIdType, p3: perp_engine_types::OrderMetadata, p4: u64) {
        assert!(perp_engine_types::is_reduce_only(&p3), 15);
        pending_order_tracker::decrease_reduce_only_order_size(p1, p0, p2, p4);
    }
    friend fun settle_liquidation(p0: address, p1: address, p2: object::Object<perp_market::PerpMarket>, p3: bool, p4: u64, p5: u64): option::Option<u64> {
        if (!(p5 > 0)) {
            let _v0 = error::invalid_argument(2);
            abort _v0
        };
        if (!(p4 > 0)) {
            let _v1 = error::invalid_argument(4);
            abort _v1
        };
        if (!(p0 != p1)) {
            let _v2 = error::invalid_argument(13);
            abort _v2
        };
        let (_v3,_v4,_v5) = get_adjusted_size_for_open_interest_cap(p0, p1, p2, p3, p5, 9223372036854775807);
        let _v6 = _v3;
        if (!(_v6 > 0)) {
            let _v7 = error::invalid_argument(8);
            abort _v7
        };
        let _v8 = option::none<builder_code_registry::BuilderCode>();
        let _v9 = accounts_collateral::validate_position_update(p0, p2, p4, p3, true, _v6, _v8, false);
        if (!position_update::is_update_successful(&_v9)) {
            let _v10 = error::invalid_argument(8);
            abort _v10
        };
        let _v11 = accounts_collateral::validate_liquidation_position_update(p1, p2, p4, !p3, false, _v6);
        let _v12 = position_update::is_update_successful(&_v11);
        loop {
            if (_v12) {
                let _v13 = option::none<order_book_types::OrderIdType>();
                let _v14 = option::none<string::String>();
                let _v15 = option::none<builder_code_registry::BuilderCode>();
                let (_v16,_v17,_v18) = accounts_collateral::commit_update_position(_v13, _v14, p4, p3, _v6, _v15, _v9, 0u128);
                let _v19 = accounts_collateral::backstop_liquidator();
                if (p0 != _v19) pending_order_tracker::update_position(p0, p2, _v16, _v17, _v18);
                let (_v20,_v21,_v22) = accounts_collateral::commit_update_position_with_backstop_liquidator(p4, !p3, _v6, _v11, p0);
                if (!(p1 != _v19)) break;
                pending_order_tracker::update_position(p1, p2, _v20, _v21, _v22);
                break
            };
            return option::none<u64>()
        };
        open_interest_tracker::mark_open_interest_delta_for_market(p2, _v4);
        option::some<u64>(_v6)
    }
}
