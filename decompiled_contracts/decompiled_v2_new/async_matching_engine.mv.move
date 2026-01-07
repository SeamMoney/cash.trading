module 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::async_matching_engine {
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::price_management;
    use 0x1::big_ordered_map;
    use 0x1b3fa27b03773a4265a09b292c5059da10b4ae8a3dbd2972245c7504e89f52e7::order_book_types;
    use 0x1::option;
    use 0x1::string;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_engine_types;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::builder_code_registry;
    use 0x1::object;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_market;
    use 0x1::signer;
    use 0x1b3fa27b03773a4265a09b292c5059da10b4ae8a3dbd2972245c7504e89f52e7::market_types;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::clearinghouse_perp;
    use 0x1b3fa27b03773a4265a09b292c5059da10b4ae8a3dbd2972245c7504e89f52e7::single_order_types;
    use 0x1::event;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::accounts_collateral;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_positions;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::liquidation;
    use 0x1::error;
    use 0x1::transaction_context;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::decibel_time;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::tp_sl_utils;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::order_placement_utils;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_market_config;
    use 0x1b3fa27b03773a4265a09b292c5059da10b4ae8a3dbd2972245c7504e89f52e7::order_placement;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::backstop_liquidator_profit_tracker;
    use 0x1::vector;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_engine;
    enum PendingRequest has store {
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
        RefreshWithdrawMarkPrice {
            mark_px: u64,
            funding_index: price_management::AccumulativeIndex,
        }
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
        client_order_id: option::Option<string::String>,
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
    struct PendingLiquidation has store {
        user: address,
        markets_witnessed: big_ordered_map::BigOrderedMap<object::Object<perp_market::PerpMarket>, bool>,
        market_during_cutoff: option::Option<object::Object<perp_market::PerpMarket>>,
        largest_slippage_tested: u64,
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
    enum SystemPurgedOrderEvent has drop, store {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
            account: address,
            order_id: order_book_types::OrderIdType,
        }
    }
    enum TwapEvent has copy, drop, store {
        V1 {
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
            client_order_id: option::Option<string::String>,
        }
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
    friend fun add_adl_to_pending(p0: object::Object<perp_market::PerpMarket>)
        acquires AsyncMatchingEngine
    {
        let _v0 = new_pending_check_adl_key();
        let _v1 = p0;
        let _v2 = object::object_address<perp_market::PerpMarket>(&_v1);
        let _v3 = &mut borrow_global_mut<AsyncMatchingEngine>(_v2).pending_requests;
        let _v4 = PendingRequest::CheckADL{};
        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v3, _v0, _v4);
    }
    fun new_pending_check_adl_key(): PendingRequestKey {
        PendingRequestKey::Liquidatation{tie_breaker: transaction_context::monotonically_increasing_counter(), time: 2}
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
        let _v1 = market_types::order_cancellation_reason_cancelled_by_user();
        let _v2 = string::utf8(vector[]);
        let _v3 = clearinghouse_perp::market_callbacks(p0);
        let _v4 = &_v3;
        let (_v5,_v6,_v7,_v8,_v9,_v10,_v11,_v12,_v13,_v14,_v15,_v16) = single_order_types::destroy_single_order<perp_engine_types::OrderMetadata>(perp_market::cancel_order(p0, _v0, p2, false, _v1, _v2, _v4));
        let _v17 = _v15;
        let (_v18,_v19,_v20) = perp_engine_types::get_twap_from_metadata(&_v17);
        let _v21 = perp_engine_types::is_reduce_only(&_v17);
        let _v22 = _v18;
        let _v23 = _v20 - _v22;
        let _v24 = TwapOrderStatus::Cancelled{_0: string::utf8(vector[67u8, 97u8, 110u8, 99u8, 101u8, 108u8, 108u8, 101u8, 100u8, 32u8, 98u8, 121u8, 32u8, 117u8, 115u8, 101u8, 114u8])};
        let _v25 = option::none<string::String>();
        event::emit<TwapEvent>(TwapEvent::V1{market: p0, account: _v5, is_buy: _v12, order_id: _v6, is_reduce_only: _v21, start_time_s: _v22, frequency_s: _v19, duration_s: _v23, orig_size: _v10, remain_size: 0, status: _v24, client_order_id: _v25});
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
                    let (_v4,_v5) = big_ordered_map::pop_front<PendingRequestKey,PendingRequest>(&mut _v2.pending_requests);
                    let _v6 = _v5;
                    let _v7 = &_v6;
                    if (_v7 is Liquidation) {
                        let _v8 = &_v7._0;
                        let PendingRequest::Liquidation{_0: _v9} = _v6;
                        let PendingLiquidation{user: _v10, markets_witnessed: _v11, market_during_cutoff: _v12, largest_slippage_tested: _v13} = _v9;
                        big_ordered_map::destroy_empty<object::Object<perp_market::PerpMarket>,bool>(_v11);
                        continue
                    };
                    if (_v7 is CheckADL) {
                        let PendingRequest::CheckADL{} = _v6;
                        continue
                    };
                    if (_v7 is TriggerADL) {
                        let PendingRequest::TriggerADL{adl_price: _v14} = _v6;
                        continue
                    };
                    if (_v7 is RefreshWithdrawMarkPrice) {
                        let PendingRequest::RefreshWithdrawMarkPrice{mark_px: _v15, funding_index: _v16} = _v6;
                        continue
                    };
                    if (_v7 is Twap) {
                        let PendingRequest::Twap{_0: _v17} = _v6;
                        let _v18 = _v17;
                        let _v19 = *&(&_v18).account;
                        let _v20 = *&(&_v18).order_id;
                        event::emit<SystemPurgedOrderEvent>(SystemPurgedOrderEvent::V1{market: p0, account: _v19, order_id: _v20});
                        continue
                    };
                    if (_v7 is Order) {
                        let PendingRequest::Order{_0: _v21} = _v6;
                        let _v22 = _v21;
                        let _v23 = *&(&_v22).account;
                        let _v24 = *&(&_v22).order_id;
                        event::emit<SystemPurgedOrderEvent>(SystemPurgedOrderEvent::V1{market: p0, account: _v23, order_id: _v24});
                        continue
                    };
                    if (!(_v7 is ContinuedOrder)) break;
                    let PendingRequest::ContinuedOrder{_0: _v25} = _v6;
                    let _v26 = _v25;
                    let _v27 = *&(&_v26).account;
                    let _v28 = *&(&_v26).order_id;
                    event::emit<SystemPurgedOrderEvent>(SystemPurgedOrderEvent::V1{market: p0, account: _v27, order_id: _v28});
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
        liquidate_position_with_fill_limit(p0, p1, 10u32);
    }
    friend fun liquidate_position_with_fill_limit(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: u32)
        acquires AsyncMatchingEngine
    {
        let _v0 = accounts_collateral::position_status(p0, p1);
        if (!perp_positions::is_account_liquidatable_detailed(&_v0, false)) {
            let _v1 = error::invalid_argument(liquidation::get_enot_liquidatable());
            abort _v1
        };
        schedule_liquidation(p0, p1);
        add_adl_to_pending(p1);
        if (p2 > 0u32) {
            trigger_matching_internal(p1, p2);
            return ()
        };
    }
    friend fun schedule_liquidation(p0: address, p1: object::Object<perp_market::PerpMarket>)
        acquires AsyncMatchingEngine
    {
        let _v0 = accounts_collateral::backstop_liquidator();
        if (!(p0 != _v0)) {
            let _v1 = error::invalid_argument(liquidation::get_ecannot_liquidate_backstop_liquidator());
            abort _v1
        };
        let _v2 = vector::empty<object::Object<perp_market::PerpMarket>>();
        let _v3 = vector::empty<bool>();
        let _v4 = big_ordered_map::new_from<object::Object<perp_market::PerpMarket>,bool>(_v2, _v3);
        let _v5 = option::none<object::Object<perp_market::PerpMarket>>();
        let _v6 = PendingLiquidation{user: p0, markets_witnessed: _v4, market_during_cutoff: _v5, largest_slippage_tested: 0};
        let _v7 = new_pending_liquidation_key();
        let _v8 = p1;
        let _v9 = object::object_address<perp_market::PerpMarket>(&_v8);
        let _v10 = &mut borrow_global_mut<AsyncMatchingEngine>(_v9).pending_requests;
        let _v11 = PendingRequest::Liquidation{_0: _v6};
        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v10, _v7, _v11);
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
                    let _v22;
                    if (big_ordered_map::is_empty<PendingRequestKey,PendingRequest>(&_v2.pending_requests)) _v21 = false else _v21 = p1 > 0u32;
                    if (!_v21) break 'l0;
                    let (_v23,_v24) = big_ordered_map::borrow_front<PendingRequestKey,PendingRequest>(&_v2.pending_requests);
                    let _v25 = _v24;
                    let _v26 = _v23;
                    if (_v3) {
                        let _v27;
                        let _v28 = &_v26;
                        if (_v28 is Liquidatation) _v27 = &_v28.time else _v27 = &_v28.time;
                        _v20 = *_v27 >= _v4
                    } else _v20 = false;
                    if (_v20) break 'l1;
                    let _v29 = &mut _v2.pending_requests;
                    let _v30 = &_v26;
                    let _v31 = big_ordered_map::remove<PendingRequestKey,PendingRequest>(_v29, _v30);
                    _v25 = &_v31;
                    if (_v25 is Order) {
                        let PendingRequest::Order{_0: _v32} = _v31;
                        let PendingOrder{account: _v33, price: _v34, orig_size: _v35, is_buy: _v36, time_in_force: _v37, is_reduce_only: _v38, order_id: _v39, client_order_id: _v40, trigger_condition: _v41, tp: _v42, sl: _v43, builder_code: _v44} = _v32;
                        _v22 = _v44;
                        _v6 = _v43;
                        _v5 = _v42;
                        _v19 = _v41;
                        _v18 = _v40;
                        _v17 = _v39;
                        _v16 = _v38;
                        _v15 = _v37;
                        _v14 = _v36;
                        _v13 = _v35;
                        _v12 = _v34;
                        _v11 = _v33;
                        let _v45 = option::none<perp_engine_types::TwapMetadata>();
                        let _v46 = perp_engine_types::new_order_metadata(_v16, _v45, _v5, _v6, _v22);
                        let _v47 = &mut p1;
                        let (_v48,_v49,_v50,_v51,_v52) = order_placement_utils::place_order_and_trigger_matching_actions(p0, _v11, _v12, _v13, _v13, _v14, _v15, _v19, _v46, _v17, _v18, true, _v47);
                        let _v53 = _v50;
                        _v10 = _v49;
                        _v17 = _v48;
                        if (option::is_some<market_types::OrderCancellationReason>(&_v53)) _v9 = order_placement::is_fill_limit_violation(option::destroy_some<market_types::OrderCancellationReason>(_v53)) else _v9 = false;
                        if (_v9) _v8 = _v10 > 0 else _v8 = false;
                        if (!_v8) continue;
                        _v7 = ContinuedPendingOrder{account: _v11, price: _v12, orig_size: _v13, is_buy: _v14, time_in_force: _v15, is_reduce_only: _v16, order_id: _v17, client_order_id: _v18, remaining_size: _v10, trigger_condition: _v19, tp: _v5, sl: _v6, builder_code: _v22};
                        let _v54 = &mut _v2.pending_requests;
                        let _v55 = PendingRequest::ContinuedOrder{_0: _v7};
                        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v54, _v26, _v55);
                        continue
                    };
                    if (_v25 is Twap) {
                        let PendingRequest::Twap{_0: _v56} = _v31;
                        let _v57 = &mut p1;
                        trigger_pending_twap(p0, _v2, _v56, _v57, _v26);
                        continue
                    };
                    if (_v25 is ContinuedOrder) {
                        let PendingRequest::ContinuedOrder{_0: _v58} = _v31;
                        let ContinuedPendingOrder{account: _v59, price: _v60, orig_size: _v61, is_buy: _v62, time_in_force: _v63, is_reduce_only: _v64, order_id: _v65, client_order_id: _v66, remaining_size: _v67, trigger_condition: _v68, tp: _v69, sl: _v70, builder_code: _v71} = _v58;
                        _v22 = _v71;
                        _v6 = _v70;
                        _v5 = _v69;
                        _v19 = _v68;
                        _v12 = _v67;
                        _v18 = _v66;
                        _v17 = _v65;
                        _v16 = _v64;
                        _v15 = _v63;
                        _v14 = _v62;
                        _v10 = _v61;
                        _v13 = _v60;
                        _v11 = _v59;
                        let _v72 = option::none<perp_engine_types::TwapMetadata>();
                        let _v73 = perp_engine_types::new_order_metadata(_v16, _v72, _v5, _v6, _v22);
                        let _v74 = &mut p1;
                        let (_v75,_v76,_v77,_v78,_v79) = order_placement_utils::place_order_and_trigger_matching_actions(p0, _v11, _v13, _v10, _v12, _v14, _v15, _v19, _v73, _v17, _v18, false, _v74);
                        let _v80 = _v77;
                        _v12 = _v76;
                        _v17 = _v75;
                        if (option::is_some<market_types::OrderCancellationReason>(&_v80)) _v9 = order_placement::is_fill_limit_violation(option::destroy_some<market_types::OrderCancellationReason>(_v80)) else _v9 = false;
                        if (_v9) _v8 = _v12 > 0 else _v8 = false;
                        if (!_v8) continue;
                        _v7 = ContinuedPendingOrder{account: _v11, price: _v13, orig_size: _v10, is_buy: _v14, time_in_force: _v15, is_reduce_only: _v16, order_id: _v17, client_order_id: _v18, remaining_size: _v12, trigger_condition: _v19, tp: _v5, sl: _v6, builder_code: _v22};
                        let _v81 = &mut _v2.pending_requests;
                        let _v82 = PendingRequest::ContinuedOrder{_0: _v7};
                        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v81, _v26, _v82);
                        continue
                    };
                    if (_v25 is Liquidation) {
                        let PendingRequest::Liquidation{_0: _v83} = _v31;
                        let PendingLiquidation{user: _v84, markets_witnessed: _v85, market_during_cutoff: _v86, largest_slippage_tested: _v87} = _v83;
                        big_ordered_map::destroy_empty<object::Object<perp_market::PerpMarket>,bool>(_v85);
                        _v11 = _v84;
                        let _v88 = &mut p1;
                        if (!liquidation::liquidate_position_internal(p0, _v11, _v88)) continue;
                        let _v89 = vector::empty<object::Object<perp_market::PerpMarket>>();
                        let _v90 = vector::empty<bool>();
                        let _v91 = big_ordered_map::new_from<object::Object<perp_market::PerpMarket>,bool>(_v89, _v90);
                        let _v92 = option::none<object::Object<perp_market::PerpMarket>>();
                        let _v93 = PendingLiquidation{user: _v11, markets_witnessed: _v91, market_during_cutoff: _v92, largest_slippage_tested: 0};
                        let _v94 = &mut _v2.pending_requests;
                        let _v95 = PendingRequest::Liquidation{_0: _v93};
                        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v94, _v26, _v95);
                        continue
                    };
                    if (_v25 is CheckADL) {
                        let PendingRequest::CheckADL{} = _v31;
                        _v13 = price_management::get_mark_price(p0);
                        _v10 = perp_market_config::get_adl_trigger_threshold(p0);
                        let _v96 = backstop_liquidator_profit_tracker::should_trigger_adl(p0, _v13, _v10);
                        if (!option::is_some<u64>(&_v96)) continue;
                        _v13 = option::destroy_some<u64>(_v96);
                        let _v97 = &mut _v2.pending_requests;
                        let _v98 = PendingRequest::TriggerADL{adl_price: _v13};
                        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v97, _v26, _v98);
                        continue
                    };
                    if (_v25 is TriggerADL) {
                        let PendingRequest::TriggerADL{adl_price: _v99} = _v31;
                        _v13 = _v99;
                        _v10 = perp_positions::get_position_size(accounts_collateral::backstop_liquidator(), p0);
                        let _v100 = &mut p1;
                        if (!liquidation::trigger_adl_internal(p0, _v10, _v13, _v100)) continue;
                        let _v101 = &mut _v2.pending_requests;
                        let _v102 = PendingRequest::TriggerADL{adl_price: _v13};
                        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v101, _v26, _v102);
                        continue
                    };
                    if (!(_v25 is RefreshWithdrawMarkPrice)) break;
                    let PendingRequest::RefreshWithdrawMarkPrice{mark_px: _v103, funding_index: _v104} = _v31;
                    let _v105 = _v104;
                    _v13 = _v103;
                    let (_v106,_v107,_v108,_v109,_v110) = price_management::update_withdraw_mark_px(p0, _v13, _v105);
                    _v10 = _v106;
                    perp_positions::update_account_status_cache_on_price_change(accounts_collateral::backstop_liquidator(), p0, _v10, _v107, _v13, _v105, _v108, _v109, _v110);
                    continue
                };
                abort 14566554180833181697
            };
            return ()
        };
    }
    fun new_pending_liquidation_key(): PendingRequestKey {
        PendingRequestKey::Liquidatation{tie_breaker: transaction_context::monotonically_increasing_counter(), time: 1}
    }
    fun new_pending_refresh_withdraw_mark_price_key(): PendingRequestKey {
        PendingRequestKey::Liquidatation{tie_breaker: transaction_context::monotonically_increasing_counter(), time: 3}
    }
    friend fun place_order(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: u64, p3: u64, p4: bool, p5: order_book_types::TimeInForce, p6: bool, p7: option::Option<order_book_types::OrderIdType>, p8: option::Option<string::String>, p9: option::Option<u64>, p10: option::Option<u64>, p11: option::Option<u64>, p12: option::Option<u64>, p13: option::Option<u64>, p14: option::Option<builder_code_registry::BuilderCode>): order_book_types::OrderIdType
        acquires AsyncMatchingEngine
    {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        if (option::is_none<order_book_types::OrderIdType>(&p7)) {
            _v0 = order_book_types::next_order_id();
            _v3 = true
        } else {
            _v0 = option::destroy_some<order_book_types::OrderIdType>(p7);
            _v3 = false
        };
        let (_v4,_v5) = tp_sl_utils::validate_and_get_child_tp_sl_orders(p0, _v0, p4, p10, p11, p12, p13);
        let _v6 = _v5;
        let _v7 = _v4;
        if (option::is_some<perp_engine_types::ChildTpSlOrder>(&_v7)) _v2 = true else _v2 = option::is_some<perp_engine_types::ChildTpSlOrder>(&_v6);
        if (_v2) {
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
                _v1 = option::some<order_book_types::TriggerCondition>(order_book_types::price_move_up_condition(_v10))
            } else if (_v9 > _v10) _v1 = option::some<order_book_types::TriggerCondition>(order_book_types::price_move_down_condition(_v10)) else abort 14
        } else _v1 = option::none<order_book_types::TriggerCondition>();
        if (_v3) {
            let _v11 = market_types::order_status_acknowledged();
            let _v12 = string::utf8(vector[]);
            let _v13 = option::none<perp_engine_types::TwapMetadata>();
            let _v14 = perp_engine_types::new_order_metadata(p6, _v13, _v7, _v6, p14);
            let _v15 = clearinghouse_perp::market_callbacks(p0);
            let _v16 = &_v15;
            perp_market::emit_event_for_order(p0, _v0, p8, p1, p3, p3, p3, p2, p4, true, _v11, _v12, _v14, _v1, p5, _v16)
        };
        if (perp_market::is_taker_order(p0, p2, p4, _v1)) add_taker_order_to_pending(p0, p1, p2, p3, p4, p5, p6, _v0, p8, _v1, _v7, _v6, p14) else {
            let _v17 = 10u32;
            let _v18 = option::none<perp_engine_types::TwapMetadata>();
            let _v19 = perp_engine_types::new_order_metadata(p6, _v18, _v7, _v6, p14);
            let _v20 = &mut _v17;
            let (_v21,_v22,_v23,_v24,_v25) = order_placement_utils::place_order_and_trigger_matching_actions(p0, p1, p2, p3, p3, p4, p5, _v1, _v19, _v0, p8, true, _v20);
        };
        trigger_matching(p0, 10u32);
        _v0
    }
    friend fun trigger_matching(p0: object::Object<perp_market::PerpMarket>, p1: u32)
        acquires AsyncMatchingEngine
    {
        trigger_matching_internal(p0, p1);
    }
    friend fun place_twap_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: u64, p3: bool, p4: bool, p5: option::Option<string::String>, p6: u64, p7: u64, p8: option::Option<builder_code_registry::BuilderCode>): order_book_types::OrderIdType {
        if (option::is_some<builder_code_registry::BuilderCode>(&p8)) {
            let _v0 = signer::address_of(p1);
            let _v1 = option::borrow<builder_code_registry::BuilderCode>(&p8);
            builder_code_registry::validate_builder_code(_v0, _v1)
        };
        perp_market_config::validate_size(p0, p2, false);
        assert!(p7 >= 120, 17);
        assert!(p7 <= 86400, 17);
        assert!(p6 >= 60, 18);
        assert!(p7 >= p6, 17);
        assert!(p7 % p6 == 0, 19);
        let _v2 = decibel_time::now_seconds();
        let _v3 = _v2 + p7;
        let _v4 = p7 / p6 + 1;
        let _v5 = perp_market_config::get_min_size(p0);
        assert!(p2 / _v4 >= _v5, 20);
        let _v6 = option::some<perp_engine_types::TwapMetadata>(perp_engine_types::new_twap_metadata(_v2, p6, _v3));
        let _v7 = option::none<perp_engine_types::ChildTpSlOrder>();
        let _v8 = option::none<perp_engine_types::ChildTpSlOrder>();
        let _v9 = perp_engine_types::new_order_metadata(p4, _v6, _v7, _v8, p8);
        let _v10 = order_book_types::next_order_id();
        if (p3) _v4 = 9223372036854775807 else _v4 = 1;
        let _v11 = signer::address_of(p1);
        let _v12 = order_book_types::immediate_or_cancel();
        let _v13 = option::some<order_book_types::TriggerCondition>(order_book_types::new_time_based_trigger_condition(decibel_time::now_seconds()));
        let _v14 = clearinghouse_perp::market_callbacks(p0);
        let _v15 = &_v14;
        let _v16 = perp_market::place_order_with_order_id(p0, _v11, _v4, p2, p2, p3, _v12, _v13, _v9, _v10, p5, 1000u32, true, true, _v15);
        let _v17 = signer::address_of(p1);
        let _v18 = TwapOrderStatus::Open{};
        event::emit<TwapEvent>(TwapEvent::V1{market: p0, account: _v17, is_buy: p3, order_id: _v10, is_reduce_only: p4, start_time_s: _v2, frequency_s: p6, duration_s: p7, orig_size: p2, remain_size: p2, status: _v18, client_order_id: p5});
        _v10
    }
    friend fun schedule_refresh_withdraw_mark_price(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: price_management::AccumulativeIndex)
        acquires AsyncMatchingEngine
    {
        let _v0 = new_pending_refresh_withdraw_mark_price_key();
        let _v1 = p0;
        let _v2 = object::object_address<perp_market::PerpMarket>(&_v1);
        let _v3 = &mut borrow_global_mut<AsyncMatchingEngine>(_v2).pending_requests;
        let _v4 = PendingRequest::RefreshWithdrawMarkPrice{mark_px: p1, funding_index: p2};
        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v3, _v0, _v4);
    }
    fun trigger_pending_twap(p0: object::Object<perp_market::PerpMarket>, p1: &mut AsyncMatchingEngine, p2: PendingTwap, p3: &mut u32, p4: PendingRequestKey) {
        let _v0;
        let PendingTwap{account: _v1, order_id: _v2, is_buy: _v3, orig_size: _v4, remaining_size: _v5, is_reduce_only: _v6, twap_start_time_s: _v7, twap_frequency_s: _v8, twap_end_time_s: _v9, builder_code: _v10, client_order_id: _v11} = p2;
        let _v12 = _v11;
        let _v13 = _v10;
        let _v14 = _v9;
        let _v15 = _v8;
        let _v16 = _v7;
        let _v17 = _v6;
        let _v18 = _v5;
        let _v19 = _v4;
        let _v20 = _v3;
        let _v21 = _v2;
        let _v22 = _v1;
        let _v23 = decibel_time::now_seconds();
        if (_v23 >= _v14) _v0 = 1 else _v0 = (_v14 - _v23) / _v15 + 1;
        let _v24 = _v18 / _v0;
        let _v25 = perp_market_config::get_lot_size(p0);
        let _v26 = _v24 / _v25 * _v25;
        let _v27 = perp_market::get_slippage_price(p0, _v20, 300);
        let _v28 = option::is_none<u64>(&_v27);
        'l1: loop {
            let _v29;
            let _v30;
            'l2: loop {
                let _v31;
                let _v32;
                'l0: loop {
                    loop {
                        let _v33;
                        let _v34;
                        let _v35;
                        let _v36;
                        let _v37;
                        let _v38;
                        if (_v28) if (_v20) {
                            _v25 = 9223372036854775807;
                            break
                        } else {
                            _v25 = 1;
                            break
                        } else {
                            let _v39 = option::destroy_some<u64>(_v27);
                            _v25 = perp_market_config::round_price_to_ticker(p0, _v39, _v20);
                            _v38 = order_book_types::next_order_id();
                            let _v40 = order_book_types::immediate_or_cancel();
                            let _v41 = option::none<order_book_types::TriggerCondition>();
                            let _v42 = option::some<perp_engine_types::TwapMetadata>(perp_engine_types::new_twap_metadata(_v16, _v15, _v14));
                            let _v43 = option::none<perp_engine_types::ChildTpSlOrder>();
                            let _v44 = option::none<perp_engine_types::ChildTpSlOrder>();
                            let _v45 = perp_engine_types::new_order_metadata(_v17, _v42, _v43, _v44, _v13);
                            let _v46 = option::none<string::String>();
                            let (_v47,_v48,_v49,_v50,_v51) = order_placement_utils::place_order_and_trigger_matching_actions(p0, _v22, _v25, _v19, _v26, _v20, _v40, _v41, _v45, _v38, _v46, true, p3);
                            _v37 = _v49;
                            _v32 = 0;
                            let _v52 = _v50;
                            vector::reverse<u64>(&mut _v52);
                            _v36 = _v52;
                            _v30 = vector::length<u64>(&_v36)
                        };
                        while (_v30 > 0) {
                            _v31 = vector::pop_back<u64>(&mut _v36);
                            _v32 = _v32 + _v31;
                            _v30 = _v30 - 1
                        };
                        vector::destroy_empty<u64>(_v36);
                        let _v53 = _v14 - _v16;
                        let _v54 = _v18 - _v32;
                        let _v55 = TwapOrderStatus::Triggered{_0: _v38, _1: _v32};
                        event::emit<TwapEvent>(TwapEvent::V1{market: p0, account: _v22, is_buy: _v20, order_id: _v21, is_reduce_only: _v17, start_time_s: _v16, frequency_s: _v15, duration_s: _v53, orig_size: _v19, remain_size: _v54, status: _v55, client_order_id: _v12});
                        if (option::is_some<market_types::OrderCancellationReason>(&_v37)) _v35 = order_placement::is_fill_limit_violation(option::destroy_some<market_types::OrderCancellationReason>(_v37)) else _v35 = false;
                        if (_v35) break 'l0;
                        _v30 = _v18 - _v32;
                        _v31 = _v0 - 1;
                        if (option::is_none<market_types::OrderCancellationReason>(&_v37)) _v34 = true else _v34 = order_placement::is_ioc_violation(option::destroy_some<market_types::OrderCancellationReason>(_v37));
                        if (!_v34) {
                            let _v56 = _v14 - _v16;
                            let _v57 = TwapOrderStatus::Cancelled{_0: string::utf8(vector[83u8, 117u8, 98u8, 32u8, 111u8, 114u8, 100u8, 101u8, 114u8, 32u8, 102u8, 97u8, 105u8, 108u8, 101u8, 100u8])};
                            event::emit<TwapEvent>(TwapEvent::V1{market: p0, account: _v22, is_buy: _v20, order_id: _v21, is_reduce_only: _v17, start_time_s: _v16, frequency_s: _v15, duration_s: _v56, orig_size: _v19, remain_size: 0, status: _v57, client_order_id: _v12})
                        };
                        if (_v34) _v33 = _v31 != 0 else _v33 = false;
                        if (!_v33) break 'l1;
                        if (_v20) {
                            _v29 = 9223372036854775807;
                            break 'l2
                        };
                        _v29 = 1;
                        break 'l2
                    };
                    let _v58 = order_book_types::immediate_or_cancel();
                    let _v59 = option::some<order_book_types::TriggerCondition>(order_book_types::new_time_based_trigger_condition(decibel_time::now_seconds() + _v15));
                    let _v60 = option::some<perp_engine_types::TwapMetadata>(perp_engine_types::new_twap_metadata(_v16, _v15, _v14));
                    let _v61 = option::none<perp_engine_types::ChildTpSlOrder>();
                    let _v62 = option::none<perp_engine_types::ChildTpSlOrder>();
                    let _v63 = perp_engine_types::new_order_metadata(_v17, _v60, _v61, _v62, _v13);
                    let _v64 = option::none<string::String>();
                    let _v65 = clearinghouse_perp::market_callbacks(p0);
                    let _v66 = &_v65;
                    let _v67 = perp_market::place_order_with_order_id(p0, _v22, _v25, _v19, _v18, _v20, _v58, _v59, _v63, _v21, _v64, 1000u32, true, true, _v66);
                    return ()
                };
                _v31 = _v26 - _v32;
                p2 = PendingTwap{account: _v22, order_id: _v21, is_buy: _v20, orig_size: _v19, remaining_size: _v31, is_reduce_only: _v17, twap_start_time_s: _v16, twap_frequency_s: _v15, twap_end_time_s: _v14, builder_code: _v13, client_order_id: _v12};
                let _v68 = &mut p1.pending_requests;
                let _v69 = PendingRequest::Twap{_0: p2};
                big_ordered_map::add<PendingRequestKey,PendingRequest>(_v68, p4, _v69);
                return ()
            };
            let _v70 = order_book_types::immediate_or_cancel();
            let _v71 = option::some<order_book_types::TriggerCondition>(order_book_types::new_time_based_trigger_condition(decibel_time::now_seconds() + _v15));
            let _v72 = option::some<perp_engine_types::TwapMetadata>(perp_engine_types::new_twap_metadata(_v16, _v15, _v14));
            let _v73 = option::none<perp_engine_types::ChildTpSlOrder>();
            let _v74 = option::none<perp_engine_types::ChildTpSlOrder>();
            let _v75 = perp_engine_types::new_order_metadata(_v17, _v72, _v73, _v74, _v13);
            let _v76 = option::none<string::String>();
            let _v77 = clearinghouse_perp::market_callbacks(p0);
            let _v78 = &_v77;
            let _v79 = perp_market::place_order_with_order_id(p0, _v22, _v29, _v19, _v30, _v20, _v70, _v71, _v75, _v21, _v76, 1000u32, true, true, _v78);
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
            let (_v2,_v3,_v4,_v5,_v6,_v7,_v8,_v9,_v10,_v11,_v12,_v13) = single_order_types::destroy_single_order<perp_engine_types::OrderMetadata>(*vector::borrow<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>>(&_v0, p1));
            let _v14 = _v12;
            let _v15 = perp_engine_types::is_reduce_only(&_v14);
            let _v16 = option::some<order_book_types::OrderIdType>(_v3);
            let _v17 = option::none<u64>();
            let _v18 = option::none<u64>();
            let _v19 = option::none<u64>();
            let _v20 = option::none<u64>();
            let _v21 = option::none<u64>();
            let _v22 = perp_engine_types::get_builder_code_from_metadata(&_v14);
            let _v23 = place_order(p0, _v2, _v6, _v7, _v9, _v11, _v15, _v16, _v4, _v17, _v18, _v19, _v20, _v21, _v22);
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
            let (_v3,_v4,_v5,_v6,_v7,_v8,_v9,_v10,_v11,_v12,_v13,_v14) = single_order_types::destroy_single_order<perp_engine_types::OrderMetadata>(*vector::borrow<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>>(&_v0, _v1));
            let _v15 = _v13;
            let (_v16,_v17,_v18) = perp_engine_types::get_twap_from_metadata(&_v15);
            let _v19 = perp_engine_types::is_reduce_only(&_v15);
            let _v20 = perp_engine_types::get_builder_code_from_metadata(&_v15);
            let _v21 = PendingTwap{account: _v3, order_id: _v4, is_buy: _v10, orig_size: _v8, remaining_size: _v9, is_reduce_only: _v19, twap_start_time_s: _v16, twap_frequency_s: _v17, twap_end_time_s: _v18, builder_code: _v20, client_order_id: _v5};
            let _v22 = new_pending_transaction_key();
            let _v23 = p0;
            let _v24 = object::object_address<perp_market::PerpMarket>(&_v23);
            let _v25 = &mut borrow_global_mut<AsyncMatchingEngine>(_v24).pending_requests;
            let _v26 = PendingRequest::Twap{_0: _v21};
            big_ordered_map::add<PendingRequestKey,PendingRequest>(_v25, _v22, _v26);
            _v1 = _v1 + 1;
            continue
        };
    }
}
