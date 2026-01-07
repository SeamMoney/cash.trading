module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::async_matching_engine {
    use 0x1::big_ordered_map;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::order_book_types;
    use 0x1::option;
    use 0x1::string;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine_types;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::builder_code_registry;
    use 0x1::object;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market;
    use 0x1::signer;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::clearinghouse_perp;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::market_types;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::single_order_types;
    use 0x1::event;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::accounts_collateral;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_positions;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::liquidation;
    use 0x1::error;
    use 0x1::transaction_context;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::decibel_time;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::tp_sl_utils;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::price_management;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::order_placement_utils;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::order_placement;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market_config;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::backstop_liquidator_profit_tracker;
    use 0x1::vector;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine;
    enum PendingRequest has copy, drop, store {
        Order {
            _0: PendingOrder,
        }
        Twap {
            _0: PendingTwap,
        }
        ContinuedOrder {
            _0: ContinuedPendingOrder,
        }
        Liquidation {
            _0: PendingLiquidation,
        }
        CheckADL,
        TriggerADL {
            adl_price: u64,
        }
        RefreshWithdrawMarkPrice,
    }
    struct PendingOrder has copy, drop, store {
        account: address,
        price: u64,
        orig_size: u64,
        is_buy: bool,
        time_in_force: order_book_types::TimeInForce,
        is_reduce_only: bool,
        order_id: order_book_types::OrderIdType,
        client_order_id: option::Option<string::String>,
        trigger_condition: option::Option<order_book_types::TriggerCondition>,
        tp: option::Option<perp_engine_types::ChildTpSlOrder>,
        sl: option::Option<perp_engine_types::ChildTpSlOrder>,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
    }
    struct PendingTwap has copy, drop, store {
        account: address,
        order_id: order_book_types::OrderIdType,
        is_buy: bool,
        orig_size: u64,
        remaining_size: u64,
        is_reduce_only: bool,
        twap_start_time_s: u64,
        twap_frequency_s: u64,
        twap_end_time_s: u64,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
    }
    struct ContinuedPendingOrder has copy, drop, store {
        account: address,
        price: u64,
        orig_size: u64,
        is_buy: bool,
        time_in_force: order_book_types::TimeInForce,
        is_reduce_only: bool,
        order_id: order_book_types::OrderIdType,
        client_order_id: option::Option<string::String>,
        remaining_size: u64,
        trigger_condition: option::Option<order_book_types::TriggerCondition>,
        tp: option::Option<perp_engine_types::ChildTpSlOrder>,
        sl: option::Option<perp_engine_types::ChildTpSlOrder>,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
    }
    struct PendingLiquidation has copy, drop, store {
        user: address,
    }
    enum AsyncMatchingEngine has key {
        V1 {
            pending_requests: big_ordered_map::BigOrderedMap<PendingRequestKey, PendingRequest>,
            async_matching_enabled: bool,
        }
    }
    enum PendingRequestKey has copy, drop, store {
        Liquidatation {
            tie_breaker: u128,
            time: u64,
        }
        RegularTransaction {
            time: u64,
            tie_breaker: u128,
        }
    }
    struct SystemPurgedOrderEvent has drop, store {
        market: object::Object<perp_market::PerpMarket>,
        account: address,
        order_id: order_book_types::OrderIdType,
    }
    struct TwapEvent has copy, drop, store {
        market: object::Object<perp_market::PerpMarket>,
        account: address,
        is_buy: bool,
        order_id: order_book_types::OrderIdType,
        is_reduce_only: bool,
        start_time_s: u64,
        frequency_s: u64,
        duration_s: u64,
        orig_size: u64,
        remain_size: u64,
        status: TwapOrderStatus,
    }
    enum TwapOrderStatus has copy, drop, store {
        Open,
        Triggered {
            _0: order_book_types::OrderIdType,
            _1: u64,
        }
        Cancelled {
            _0: string::String,
        }
    }
    friend fun register_market(p0: &signer, p1: bool) {
        let _v0 = signer::address_of(p0);
        if (exists<AsyncMatchingEngine>(_v0)) abort 10;
        let _v1 = AsyncMatchingEngine::V1{pending_requests: big_ordered_map::new_with_config<PendingRequestKey,PendingRequest>(0u16, 16u16, true), async_matching_enabled: p1};
        move_to<AsyncMatchingEngine>(p0, _v1);
    }
    public fun add_adl_check(p0: object::Object<perp_market::PerpMarket>)
        acquires AsyncMatchingEngine
    {
        add_adl_to_pending(p0);
        trigger_matching_internal(p0, 1u32);
    }
    friend fun add_adl_to_pending(p0: object::Object<perp_market::PerpMarket>)
        acquires AsyncMatchingEngine
    {
        let _v0 = new_pending_check_adl_key();
        let _v1 = new_pending_refresh_withdraw_mark_price_key();
        let _v2 = p0;
        let _v3 = object::object_address<perp_market::PerpMarket>(&_v2);
        let _v4 = &mut borrow_global_mut<AsyncMatchingEngine>(_v3).pending_requests;
        let _v5 = PendingRequest::CheckADL{};
        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v4, _v0, _v5);
        let _v6 = PendingRequest::RefreshWithdrawMarkPrice{};
        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v4, _v1, _v6);
    }
    fun trigger_matching_internal(p0: object::Object<perp_market::PerpMarket>, p1: u32)
        acquires AsyncMatchingEngine
    {
        let _v0 = p0;
        let _v1 = object::object_address<perp_market::PerpMarket>(&_v0);
        let _v2 = borrow_global_mut<AsyncMatchingEngine>(_v1);
        let _v3 = *&_v2.async_matching_enabled;
        let _v4 = decibel_time::now_microseconds();
        assert!(p1 > 0u32, 16);
        'l0: loop {
            'l1: loop {
                loop {
                    let _v5;
                    let _v6;
                    let _v7;
                    let _v8;
                    let _v9;
                    let _v10;
                    let _v11;
                    let _v12;
                    let _v13;
                    let _v14;
                    let _v15;
                    let _v16;
                    let _v17;
                    let _v18;
                    let _v19;
                    let _v20;
                    let _v21;
                    if (big_ordered_map::is_empty<PendingRequestKey,PendingRequest>(&_v2.pending_requests)) _v20 = false else _v20 = p1 > 0u32;
                    if (!_v20) break 'l0;
                    let (_v22,_v23) = big_ordered_map::borrow_front<PendingRequestKey,PendingRequest>(&_v2.pending_requests);
                    let _v24 = _v23;
                    let _v25 = _v22;
                    if (_v3) {
                        let _v26;
                        let _v27 = &_v25;
                        if (_v27 is Liquidatation) _v26 = &_v27.time else _v26 = &_v27.time;
                        _v19 = *_v26 >= _v4
                    } else _v19 = false;
                    if (_v19) break 'l1;
                    let _v28 = &mut _v2.pending_requests;
                    let _v29 = &_v25;
                    let _v30 = big_ordered_map::remove<PendingRequestKey,PendingRequest>(_v28, _v29);
                    _v24 = &_v30;
                    if (_v24 is Order) {
                        let PendingRequest::Order{_0: _v31} = _v30;
                        let PendingOrder{account: _v32, price: _v33, orig_size: _v34, is_buy: _v35, time_in_force: _v36, is_reduce_only: _v37, order_id: _v38, client_order_id: _v39, trigger_condition: _v40, tp: _v41, sl: _v42, builder_code: _v43} = _v31;
                        _v21 = _v43;
                        _v18 = _v42;
                        _v17 = _v41;
                        _v16 = _v40;
                        _v15 = _v39;
                        _v14 = _v38;
                        _v13 = _v37;
                        _v12 = _v36;
                        _v11 = _v35;
                        _v10 = _v34;
                        _v9 = _v33;
                        _v8 = _v32;
                        if (_v10 == 0) continue;
                        let _v44 = option::none<perp_engine_types::TwapMetadata>();
                        let _v45 = perp_engine_types::new_order_metadata(_v13, _v44, _v17, _v18, _v21);
                        let _v46 = &mut p1;
                        let (_v47,_v48,_v49,_v50,_v51) = order_placement_utils::place_order_and_trigger_matching_actions(p0, _v8, _v9, _v10, _v10, _v11, _v12, _v16, _v45, _v14, _v15, true, _v46);
                        let _v52 = _v49;
                        _v7 = _v48;
                        _v14 = _v47;
                        if (option::is_some<order_placement::OrderCancellationReason>(&_v52)) _v6 = order_placement::is_fill_limit_violation(option::destroy_some<order_placement::OrderCancellationReason>(_v52)) else _v6 = false;
                        if (!_v6) continue;
                        _v5 = ContinuedPendingOrder{account: _v8, price: _v9, orig_size: _v10, is_buy: _v11, time_in_force: _v12, is_reduce_only: _v13, order_id: _v14, client_order_id: _v15, remaining_size: _v7, trigger_condition: _v16, tp: _v17, sl: _v18, builder_code: _v21};
                        let _v53 = &mut _v2.pending_requests;
                        let _v54 = PendingRequest::ContinuedOrder{_0: _v5};
                        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v53, _v25, _v54);
                        continue
                    };
                    if (_v24 is Twap) {
                        let PendingRequest::Twap{_0: _v55} = _v30;
                        let _v56 = &mut p1;
                        trigger_pending_twap(p0, _v2, _v55, _v56, _v25);
                        continue
                    };
                    if (_v24 is ContinuedOrder) {
                        let _v57;
                        let PendingRequest::ContinuedOrder{_0: _v58} = _v30;
                        let ContinuedPendingOrder{account: _v59, price: _v60, orig_size: _v61, is_buy: _v62, time_in_force: _v63, is_reduce_only: _v64, order_id: _v65, client_order_id: _v66, remaining_size: _v67, trigger_condition: _v68, tp: _v69, sl: _v70, builder_code: _v71} = _v58;
                        _v21 = _v71;
                        _v18 = _v70;
                        _v17 = _v69;
                        _v16 = _v68;
                        _v7 = _v67;
                        _v15 = _v66;
                        _v14 = _v65;
                        _v13 = _v64;
                        _v12 = _v63;
                        _v11 = _v62;
                        _v10 = _v61;
                        _v9 = _v60;
                        _v8 = _v59;
                        if (_v10 == 0) _v6 = true else _v6 = _v7 == 0;
                        if (_v6) continue;
                        let _v72 = option::none<perp_engine_types::TwapMetadata>();
                        let _v73 = perp_engine_types::new_order_metadata(_v13, _v72, _v17, _v18, _v21);
                        let _v74 = &mut p1;
                        let (_v75,_v76,_v77,_v78,_v79) = order_placement_utils::place_order_and_trigger_matching_actions(p0, _v8, _v9, _v10, _v7, _v11, _v12, _v16, _v73, _v14, _v15, false, _v74);
                        let _v80 = _v77;
                        if (option::is_some<order_placement::OrderCancellationReason>(&_v80)) _v57 = order_placement::is_fill_limit_violation(option::destroy_some<order_placement::OrderCancellationReason>(_v80)) else _v57 = false;
                        if (!_v57) continue;
                        _v5 = ContinuedPendingOrder{account: _v8, price: _v9, orig_size: _v10, is_buy: _v11, time_in_force: _v12, is_reduce_only: _v13, order_id: _v75, client_order_id: _v15, remaining_size: _v76, trigger_condition: _v16, tp: _v17, sl: _v18, builder_code: _v21};
                        let _v81 = &mut _v2.pending_requests;
                        let _v82 = PendingRequest::ContinuedOrder{_0: _v5};
                        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v81, _v25, _v82);
                        continue
                    };
                    if (_v24 is Liquidation) {
                        let PendingRequest::Liquidation{_0: _v83} = _v30;
                        let PendingLiquidation{user: _v84} = _v83;
                        _v8 = _v84;
                        let _v85 = &mut p1;
                        if (!liquidation::liquidate_position_internal(p0, _v8, _v85)) continue;
                        let _v86 = PendingLiquidation{user: _v8};
                        let _v87 = &mut _v2.pending_requests;
                        let _v88 = PendingRequest::Liquidation{_0: _v86};
                        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v87, _v25, _v88);
                        continue
                    };
                    if (_v24 is CheckADL) {
                        let PendingRequest::CheckADL{} = _v30;
                        _v9 = price_management::get_mark_price(p0);
                        _v10 = perp_market_config::get_adl_trigger_threshold(p0);
                        let _v89 = backstop_liquidator_profit_tracker::should_trigger_adl(p0, _v9, _v10);
                        if (!option::is_some<u64>(&_v89)) continue;
                        _v9 = option::destroy_some<u64>(_v89);
                        let _v90 = &mut _v2.pending_requests;
                        let _v91 = PendingRequest::TriggerADL{adl_price: _v9};
                        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v90, _v25, _v91);
                        continue
                    };
                    if (_v24 is TriggerADL) {
                        let PendingRequest::TriggerADL{adl_price: _v92} = _v30;
                        _v9 = _v92;
                        _v10 = perp_positions::get_position_size(accounts_collateral::backstop_liquidator(), p0);
                        let _v93 = &mut p1;
                        if (!liquidation::trigger_adl_internal(p0, _v10, _v9, _v93)) continue;
                        let _v94 = &mut _v2.pending_requests;
                        let _v95 = PendingRequest::TriggerADL{adl_price: _v9};
                        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v94, _v25, _v95);
                        continue
                    };
                    if (!(_v24 is RefreshWithdrawMarkPrice)) break;
                    let PendingRequest::RefreshWithdrawMarkPrice{} = _v30;
                    price_management::update_withdraw_mark_px(p0);
                    continue
                };
                abort 14566554180833181697
            };
            return ()
        };
    }
    fun new_pending_check_adl_key(): PendingRequestKey {
        PendingRequestKey::Liquidatation{tie_breaker: transaction_context::monotonically_increasing_counter(), time: 2}
    }
    fun new_pending_refresh_withdraw_mark_price_key(): PendingRequestKey {
        PendingRequestKey::Liquidatation{tie_breaker: transaction_context::monotonically_increasing_counter(), time: 3}
    }
    fun add_taker_order_to_pending(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: u64, p3: u64, p4: bool, p5: order_book_types::TimeInForce, p6: bool, p7: order_book_types::OrderIdType, p8: option::Option<string::String>, p9: option::Option<order_book_types::TriggerCondition>, p10: option::Option<perp_engine_types::ChildTpSlOrder>, p11: option::Option<perp_engine_types::ChildTpSlOrder>, p12: option::Option<builder_code_registry::BuilderCode>)
        acquires AsyncMatchingEngine
    {
        let _v0 = new_pending_transaction_key();
        let _v1 = PendingOrder{account: p1, price: p2, orig_size: p3, is_buy: p4, time_in_force: p5, is_reduce_only: p6, order_id: p7, client_order_id: p8, trigger_condition: p9, tp: p10, sl: p11, builder_code: p12};
        let _v2 = p0;
        let _v3 = object::object_address<perp_market::PerpMarket>(&_v2);
        let _v4 = &mut borrow_global_mut<AsyncMatchingEngine>(_v3).pending_requests;
        let _v5 = PendingRequest::Order{_0: _v1};
        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v4, _v0, _v5);
    }
    fun new_pending_transaction_key(): PendingRequestKey {
        let _v0 = decibel_time::now_microseconds();
        let _v1 = transaction_context::monotonically_increasing_counter();
        PendingRequestKey::RegularTransaction{time: _v0, tie_breaker: _v1}
    }
    friend fun cancel_twap_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: order_book_types::OrderIdType) {
        let _v0 = signer::address_of(p1);
        let _v1 = clearinghouse_perp::market_callbacks(p0);
        let _v2 = &_v1;
        let (_v3,_v4,_v5,_v6,_v7,_v8,_v9,_v10,_v11,_v12,_v13) = single_order_types::destroy_single_order<perp_engine_types::OrderMetadata>(perp_market::cancel_order(p0, _v0, p2, false, _v2));
        let _v14 = _v13;
        let (_v15,_v16,_v17) = perp_engine_types::get_twap_from_metadata(&_v14);
        let _v18 = perp_engine_types::is_reduce_only(&_v14);
        let _v19 = _v15;
        let _v20 = _v17 - _v19;
        let _v21 = TwapOrderStatus::Cancelled{_0: string::utf8(vector[67u8, 97u8, 110u8, 99u8, 101u8, 108u8, 108u8, 101u8, 100u8, 32u8, 98u8, 121u8, 32u8, 117u8, 115u8, 101u8, 114u8])};
        event::emit<TwapEvent>(TwapEvent{market: p0, account: _v3, is_buy: _v10, order_id: _v4, is_reduce_only: _v18, start_time_s: _v19, frequency_s: _v16, duration_s: _v20, orig_size: _v8, remain_size: 0, status: _v21});
    }
    friend fun drain_async_queue(p0: object::Object<perp_market::PerpMarket>)
        acquires AsyncMatchingEngine
    {
        let _v0 = p0;
        let _v1 = object::object_address<perp_market::PerpMarket>(&_v0);
        let _v2 = borrow_global_mut<AsyncMatchingEngine>(_v1);
        let _v3 = 0;
        'l0: loop {
            'l1: loop {
                loop {
                    if (big_ordered_map::is_empty<PendingRequestKey,PendingRequest>(&_v2.pending_requests)) break 'l0;
                    if (_v3 >= 100) break 'l1;
                    _v3 = _v3 + 1;
                    let (_v4,_v5) = big_ordered_map::borrow_front<PendingRequestKey,PendingRequest>(&_v2.pending_requests);
                    let _v6 = _v5;
                    let _v7 = _v4;
                    let _v8 = &mut _v2.pending_requests;
                    let _v9 = &_v7;
                    let _v10 = big_ordered_map::remove<PendingRequestKey,PendingRequest>(_v8, _v9);
                    _v6 = &_v10;
                    if (_v6 is Liquidation) {
                        let PendingRequest::Liquidation{_0: _v11} = _v10;
                        continue
                    };
                    if (_v6 is CheckADL) {
                        let PendingRequest::CheckADL{} = _v10;
                        continue
                    };
                    if (_v6 is TriggerADL) {
                        let PendingRequest::TriggerADL{adl_price: _v12} = _v10;
                        continue
                    };
                    if (_v6 is RefreshWithdrawMarkPrice) {
                        let PendingRequest::RefreshWithdrawMarkPrice{} = _v10;
                        continue
                    };
                    if (_v6 is Twap) {
                        let PendingRequest::Twap{_0: _v13} = _v10;
                        let _v14 = _v13;
                        let _v15 = *&(&_v14).account;
                        let _v16 = *&(&_v14).order_id;
                        event::emit<SystemPurgedOrderEvent>(SystemPurgedOrderEvent{market: p0, account: _v15, order_id: _v16});
                        continue
                    };
                    if (_v6 is Order) {
                        let PendingRequest::Order{_0: _v17} = _v10;
                        let _v18 = _v17;
                        let _v19 = *&(&_v18).account;
                        let _v20 = *&(&_v18).order_id;
                        event::emit<SystemPurgedOrderEvent>(SystemPurgedOrderEvent{market: p0, account: _v19, order_id: _v20});
                        continue
                    };
                    if (!(_v6 is ContinuedOrder)) break;
                    let PendingRequest::ContinuedOrder{_0: _v21} = _v10;
                    let _v22 = _v21;
                    let _v23 = *&(&_v22).account;
                    let _v24 = *&(&_v22).order_id;
                    event::emit<SystemPurgedOrderEvent>(SystemPurgedOrderEvent{market: p0, account: _v23, order_id: _v24});
                    continue
                };
                abort 14566554180833181697
            };
            return ()
        };
    }
    friend fun liquidate_position(p0: address, p1: object::Object<perp_market::PerpMarket>)
        acquires AsyncMatchingEngine
    {
        liquidate_position_with_fill_limit(p0, p1, 1u32);
    }
    friend fun liquidate_position_with_fill_limit(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: u32)
        acquires AsyncMatchingEngine
    {
        let _v0 = accounts_collateral::position_status(p0, p1);
        if (!perp_positions::is_account_liquidatable_detailed(&_v0, false)) {
            let _v1 = error::invalid_argument(liquidation::get_enot_liquidatable());
            abort _v1
        };
        let _v2 = accounts_collateral::backstop_liquidator();
        if (!(p0 != _v2)) {
            let _v3 = error::invalid_argument(liquidation::get_ecannot_liquidate_backstop_liquidator());
            abort _v3
        };
        let _v4 = PendingLiquidation{user: p0};
        let _v5 = new_pending_liquidation_key();
        let _v6 = p1;
        let _v7 = object::object_address<perp_market::PerpMarket>(&_v6);
        let _v8 = &mut borrow_global_mut<AsyncMatchingEngine>(_v7).pending_requests;
        let _v9 = PendingRequest::Liquidation{_0: _v4};
        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v8, _v5, _v9);
        if (p2 > 0u32) {
            trigger_matching_internal(p1, p2);
            return ()
        };
    }
    fun new_pending_liquidation_key(): PendingRequestKey {
        PendingRequestKey::Liquidatation{tie_breaker: transaction_context::monotonically_increasing_counter(), time: 1}
    }
    friend fun place_order(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: u64, p3: u64, p4: bool, p5: order_book_types::TimeInForce, p6: bool, p7: option::Option<order_book_types::OrderIdType>, p8: option::Option<string::String>, p9: option::Option<u64>, p10: option::Option<u64>, p11: option::Option<u64>, p12: option::Option<u64>, p13: option::Option<u64>, p14: option::Option<builder_code_registry::BuilderCode>): order_book_types::OrderIdType
        acquires AsyncMatchingEngine
    {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        if (option::is_none<order_book_types::OrderIdType>(&p7)) {
            _v3 = order_book_types::next_order_id();
            _v2 = true
        } else {
            _v3 = option::destroy_some<order_book_types::OrderIdType>(p7);
            _v2 = false
        };
        let (_v4,_v5) = tp_sl_utils::validate_and_get_child_tp_sl_orders(p0, _v3, p4, p10, p11, p12, p13);
        let _v6 = _v5;
        let _v7 = _v4;
        if (option::is_some<perp_engine_types::ChildTpSlOrder>(&_v7)) _v1 = true else _v1 = option::is_some<perp_engine_types::ChildTpSlOrder>(&_v6);
        if (_v1) {
            if (p6) abort 12;
            assert!(option::is_none<u64>(&p9), 13)
        };
        if (option::is_some<builder_code_registry::BuilderCode>(&p14)) {
            let _v8 = option::borrow<builder_code_registry::BuilderCode>(&p14);
            builder_code_registry::validate_builder_code(p1, _v8)
        };
        if (option::is_some<u64>(&p9)) {
            let _v9 = price_management::get_mark_price(p0);
            let _v10 = option::destroy_some<u64>(p9);
            if (p4) {
                assert!(_v9 < _v10, 14);
                _v0 = option::some<order_book_types::TriggerCondition>(order_book_types::price_move_up_condition(_v10))
            } else if (_v9 > _v10) _v0 = option::some<order_book_types::TriggerCondition>(order_book_types::price_move_down_condition(_v10)) else abort 14
        } else _v0 = option::none<order_book_types::TriggerCondition>();
        if (_v2) {
            let _v11 = market_types::order_status_acknowledged();
            let _v12 = string::utf8(vector[]);
            let _v13 = option::none<perp_engine_types::TwapMetadata>();
            let _v14 = perp_engine_types::new_order_metadata(p6, _v13, _v7, _v6, p14);
            let _v15 = clearinghouse_perp::market_callbacks(p0);
            let _v16 = &_v15;
            perp_market::emit_event_for_order(p0, _v3, p8, p1, p3, p3, p3, p2, p4, true, _v11, _v12, _v14, _v0, p5, _v16)
        };
        if (perp_market::is_taker_order(p0, p2, p4, _v0)) add_taker_order_to_pending(p0, p1, p2, p3, p4, p5, p6, _v3, p8, _v0, _v7, _v6, p14) else {
            let _v17 = 1u32;
            let _v18 = option::none<perp_engine_types::TwapMetadata>();
            let _v19 = perp_engine_types::new_order_metadata(p6, _v18, _v7, _v6, p14);
            let _v20 = &mut _v17;
            let (_v21,_v22,_v23,_v24,_v25) = order_placement_utils::place_order_and_trigger_matching_actions(p0, p1, p2, p3, p3, p4, p5, _v0, _v19, _v3, p8, true, _v20);
        };
        trigger_matching(p0, 1u32);
        _v3
    }
    friend fun trigger_matching(p0: object::Object<perp_market::PerpMarket>, p1: u32)
        acquires AsyncMatchingEngine
    {
        trigger_matching_internal(p0, p1);
    }
    friend fun place_twap_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: u64, p3: bool, p4: bool, p5: u64, p6: u64, p7: option::Option<builder_code_registry::BuilderCode>): order_book_types::OrderIdType {
        if (option::is_some<builder_code_registry::BuilderCode>(&p7)) {
            let _v0 = signer::address_of(p1);
            let _v1 = option::borrow<builder_code_registry::BuilderCode>(&p7);
            builder_code_registry::validate_builder_code(_v0, _v1)
        };
        perp_market_config::validate_size(p0, p2, false);
        assert!(p6 >= 120, 17);
        assert!(p6 <= 86400, 17);
        assert!(p5 >= 60, 18);
        assert!(p6 >= p5, 17);
        assert!(p6 % p5 == 0, 19);
        let _v2 = decibel_time::now_seconds();
        let _v3 = _v2 + p6;
        let _v4 = option::some<perp_engine_types::TwapMetadata>(perp_engine_types::new_twap_metadata(_v2, p5, _v3));
        let _v5 = option::none<perp_engine_types::ChildTpSlOrder>();
        let _v6 = option::none<perp_engine_types::ChildTpSlOrder>();
        let _v7 = perp_engine_types::new_order_metadata(p4, _v4, _v5, _v6, p7);
        let _v8 = order_book_types::next_order_id();
        if (p3) _v3 = 9223372036854775807 else _v3 = 1;
        let _v9 = signer::address_of(p1);
        let _v10 = order_book_types::immediate_or_cancel();
        let _v11 = option::some<order_book_types::TriggerCondition>(order_book_types::new_time_based_trigger_condition(decibel_time::now_seconds()));
        let _v12 = option::none<string::String>();
        let _v13 = clearinghouse_perp::market_callbacks(p0);
        let _v14 = &_v13;
        let _v15 = perp_market::place_order_with_order_id(p0, _v9, _v3, p2, p2, p3, _v10, _v11, _v7, _v8, _v12, 1000u32, true, true, _v14);
        let _v16 = signer::address_of(p1);
        let _v17 = TwapOrderStatus::Open{};
        event::emit<TwapEvent>(TwapEvent{market: p0, account: _v16, is_buy: p3, order_id: _v8, is_reduce_only: p4, start_time_s: _v2, frequency_s: p5, duration_s: p6, orig_size: p2, remain_size: p2, status: _v17});
        _v8
    }
    fun trigger_pending_twap(p0: object::Object<perp_market::PerpMarket>, p1: &mut AsyncMatchingEngine, p2: PendingTwap, p3: &mut u32, p4: PendingRequestKey) {
        let _v0;
        let PendingTwap{account: _v1, order_id: _v2, is_buy: _v3, orig_size: _v4, remaining_size: _v5, is_reduce_only: _v6, twap_start_time_s: _v7, twap_frequency_s: _v8, twap_end_time_s: _v9, builder_code: _v10} = p2;
        let _v11 = _v10;
        let _v12 = _v9;
        let _v13 = _v8;
        let _v14 = _v7;
        let _v15 = _v6;
        let _v16 = _v5;
        let _v17 = _v4;
        let _v18 = _v3;
        let _v19 = _v2;
        let _v20 = _v1;
        let _v21 = decibel_time::now_seconds();
        if (_v21 >= _v12) _v0 = 1 else _v0 = (_v12 - _v21) / _v13 + 1;
        let _v22 = _v16 / _v0;
        let _v23 = perp_market_config::get_lot_size(p0);
        let _v24 = _v22 / _v23 * _v23;
        let _v25 = perp_market::get_slippage_price(p0, _v18, 300);
        let _v26 = option::is_none<u64>(&_v25);
        'l1: loop {
            let _v27;
            let _v28;
            'l2: loop {
                let _v29;
                let _v30;
                'l0: loop {
                    loop {
                        let _v31;
                        let _v32;
                        let _v33;
                        let _v34;
                        let _v35;
                        let _v36;
                        if (_v26) if (_v18) {
                            _v23 = 9223372036854775807;
                            break
                        } else {
                            _v23 = 1;
                            break
                        } else {
                            let _v37 = option::destroy_some<u64>(_v25);
                            _v23 = perp_market_config::round_price_to_ticker(p0, _v37, _v18);
                            _v36 = order_book_types::next_order_id();
                            let _v38 = order_book_types::immediate_or_cancel();
                            let _v39 = option::none<order_book_types::TriggerCondition>();
                            let _v40 = option::some<perp_engine_types::TwapMetadata>(perp_engine_types::new_twap_metadata(_v14, _v13, _v12));
                            let _v41 = option::none<perp_engine_types::ChildTpSlOrder>();
                            let _v42 = option::none<perp_engine_types::ChildTpSlOrder>();
                            let _v43 = perp_engine_types::new_order_metadata(_v15, _v40, _v41, _v42, _v11);
                            let _v44 = option::none<string::String>();
                            let (_v45,_v46,_v47,_v48,_v49) = order_placement_utils::place_order_and_trigger_matching_actions(p0, _v20, _v23, _v17, _v24, _v18, _v38, _v39, _v43, _v36, _v44, true, p3);
                            _v35 = _v47;
                            _v30 = 0;
                            let _v50 = _v48;
                            vector::reverse<u64>(&mut _v50);
                            _v34 = _v50;
                            _v28 = vector::length<u64>(&_v34)
                        };
                        while (_v28 > 0) {
                            _v29 = vector::pop_back<u64>(&mut _v34);
                            _v30 = _v30 + _v29;
                            _v28 = _v28 - 1
                        };
                        vector::destroy_empty<u64>(_v34);
                        let _v51 = _v12 - _v14;
                        let _v52 = _v16 - _v30;
                        let _v53 = TwapOrderStatus::Triggered{_0: _v36, _1: _v30};
                        event::emit<TwapEvent>(TwapEvent{market: p0, account: _v20, is_buy: _v18, order_id: _v19, is_reduce_only: _v15, start_time_s: _v14, frequency_s: _v13, duration_s: _v51, orig_size: _v17, remain_size: _v52, status: _v53});
                        if (option::is_some<order_placement::OrderCancellationReason>(&_v35)) _v33 = order_placement::is_fill_limit_violation(option::destroy_some<order_placement::OrderCancellationReason>(_v35)) else _v33 = false;
                        if (_v33) break 'l0;
                        _v28 = _v16 - _v30;
                        _v29 = _v0 - 1;
                        if (option::is_none<order_placement::OrderCancellationReason>(&_v35)) _v32 = true else _v32 = order_placement::is_ioc_violation(option::destroy_some<order_placement::OrderCancellationReason>(_v35));
                        if (!_v32) {
                            let _v54 = _v12 - _v14;
                            let _v55 = TwapOrderStatus::Cancelled{_0: string::utf8(vector[83u8, 117u8, 98u8, 32u8, 111u8, 114u8, 100u8, 101u8, 114u8, 32u8, 102u8, 97u8, 105u8, 108u8, 101u8, 100u8])};
                            event::emit<TwapEvent>(TwapEvent{market: p0, account: _v20, is_buy: _v18, order_id: _v19, is_reduce_only: _v15, start_time_s: _v14, frequency_s: _v13, duration_s: _v54, orig_size: _v17, remain_size: 0, status: _v55})
                        };
                        if (_v32) _v31 = _v29 != 0 else _v31 = false;
                        if (!_v31) break 'l1;
                        if (_v18) {
                            _v27 = 9223372036854775807;
                            break 'l2
                        };
                        _v27 = 1;
                        break 'l2
                    };
                    let _v56 = order_book_types::immediate_or_cancel();
                    let _v57 = option::some<order_book_types::TriggerCondition>(order_book_types::new_time_based_trigger_condition(decibel_time::now_seconds() + _v13));
                    let _v58 = option::some<perp_engine_types::TwapMetadata>(perp_engine_types::new_twap_metadata(_v14, _v13, _v12));
                    let _v59 = option::none<perp_engine_types::ChildTpSlOrder>();
                    let _v60 = option::none<perp_engine_types::ChildTpSlOrder>();
                    let _v61 = perp_engine_types::new_order_metadata(_v15, _v58, _v59, _v60, _v11);
                    let _v62 = option::none<string::String>();
                    let _v63 = clearinghouse_perp::market_callbacks(p0);
                    let _v64 = &_v63;
                    let _v65 = perp_market::place_order_with_order_id(p0, _v20, _v23, _v17, _v16, _v18, _v56, _v57, _v61, _v19, _v62, 1000u32, true, true, _v64);
                    return ()
                };
                _v29 = _v24 - _v30;
                p2 = PendingTwap{account: _v20, order_id: _v19, is_buy: _v18, orig_size: _v17, remaining_size: _v29, is_reduce_only: _v15, twap_start_time_s: _v14, twap_frequency_s: _v13, twap_end_time_s: _v12, builder_code: _v11};
                let _v66 = &mut p1.pending_requests;
                let _v67 = PendingRequest::Twap{_0: p2};
                big_ordered_map::add<PendingRequestKey,PendingRequest>(_v66, p4, _v67);
                return ()
            };
            let _v68 = order_book_types::immediate_or_cancel();
            let _v69 = option::some<order_book_types::TriggerCondition>(order_book_types::new_time_based_trigger_condition(decibel_time::now_seconds() + _v13));
            let _v70 = option::some<perp_engine_types::TwapMetadata>(perp_engine_types::new_twap_metadata(_v14, _v13, _v12));
            let _v71 = option::none<perp_engine_types::ChildTpSlOrder>();
            let _v72 = option::none<perp_engine_types::ChildTpSlOrder>();
            let _v73 = perp_engine_types::new_order_metadata(_v15, _v70, _v71, _v72, _v11);
            let _v74 = option::none<string::String>();
            let _v75 = clearinghouse_perp::market_callbacks(p0);
            let _v76 = &_v75;
            let _v77 = perp_market::place_order_with_order_id(p0, _v20, _v27, _v17, _v28, _v18, _v68, _v69, _v73, _v19, _v74, 1000u32, true, true, _v76);
            return ()
        };
    }
    friend fun trigger_price_based_conditional_orders(p0: object::Object<perp_market::PerpMarket>, p1: u64)
        acquires AsyncMatchingEngine
    {
        let _v0 = perp_market::take_ready_price_based_orders(p0, p1, 10);
        p1 = 0;
        loop {
            let _v1 = vector::length<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>>(&_v0);
            if (!(p1 < _v1)) break;
            let (_v2,_v3,_v4,_v5,_v6,_v7,_v8,_v9,_v10,_v11,_v12) = single_order_types::destroy_single_order<perp_engine_types::OrderMetadata>(*vector::borrow<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>>(&_v0, p1));
            let _v13 = _v12;
            let _v14 = perp_engine_types::is_reduce_only(&_v13);
            let _v15 = option::some<order_book_types::OrderIdType>(_v3);
            let _v16 = option::none<u64>();
            let _v17 = option::none<u64>();
            let _v18 = option::none<u64>();
            let _v19 = option::none<u64>();
            let _v20 = option::none<u64>();
            let _v21 = perp_engine_types::get_builder_code_from_metadata(&_v13);
            let _v22 = place_order(p0, _v2, _v6, _v7, _v9, _v11, _v14, _v15, _v4, _v16, _v17, _v18, _v19, _v20, _v21);
            p1 = p1 + 1;
            continue
        };
    }
    friend fun trigger_twap_orders(p0: object::Object<perp_market::PerpMarket>)
        acquires AsyncMatchingEngine
    {
        let _v0 = perp_market::take_ready_time_based_orders(p0, 10);
        let _v1 = 0;
        loop {
            let _v2 = vector::length<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>>(&_v0);
            if (!(_v1 < _v2)) break;
            let (_v3,_v4,_v5,_v6,_v7,_v8,_v9,_v10,_v11,_v12,_v13) = single_order_types::destroy_single_order<perp_engine_types::OrderMetadata>(*vector::borrow<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>>(&_v0, _v1));
            let _v14 = _v13;
            let (_v15,_v16,_v17) = perp_engine_types::get_twap_from_metadata(&_v14);
            let _v18 = perp_engine_types::is_reduce_only(&_v14);
            let _v19 = perp_engine_types::get_builder_code_from_metadata(&_v14);
            let _v20 = PendingTwap{account: _v3, order_id: _v4, is_buy: _v10, orig_size: _v8, remaining_size: _v9, is_reduce_only: _v18, twap_start_time_s: _v15, twap_frequency_s: _v16, twap_end_time_s: _v17, builder_code: _v19};
            let _v21 = new_pending_transaction_key();
            let _v22 = p0;
            let _v23 = object::object_address<perp_market::PerpMarket>(&_v22);
            let _v24 = &mut borrow_global_mut<AsyncMatchingEngine>(_v23).pending_requests;
            let _v25 = PendingRequest::Twap{_0: _v20};
            big_ordered_map::add<PendingRequestKey,PendingRequest>(_v24, _v21, _v25);
            _v1 = _v1 + 1;
            continue
        };
    }
}
