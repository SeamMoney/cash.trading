module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::async_matching_engine {
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::liquidation;
    use 0x1::big_ordered_map;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_order;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine_types;
    use 0x1::option;
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::order_book_types;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::builder_code_registry;
    use 0x1::string;
    use 0x1::signer;
    use 0x1::transaction_context;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::decibel_time;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::market_types;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::clearinghouse_perp;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::single_order_types;
    use 0x1::event;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::tp_sl_utils;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::price_management;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::work_unit_utils;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::order_placement_utils;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market_config;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::order_placement;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::accounts_collateral;
    use 0x1::error;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_positions;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::backstop_liquidator_profit_tracker;
    use 0x1::vector;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine;
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
        PendingLiquidation {
            user: address,
        }
        MarginCall {
            user: address,
            continuation: liquidation::MarginCallContinuation,
        }
        CheckADL,
        TriggerADL {
            adl_price: u64,
        }
        CommitMarkPrice {
            mark_px: u64,
        }
    }
    struct PendingOrder has copy, drop, store {
        order_args: perp_order::PerpOrderRequestExtendedArgs,
        order_metadata: perp_engine_types::OrderMetadata,
    }
    struct PendingTwap has copy, drop, store {
        account: address,
        order_id: order_book_types::OrderId,
        is_buy: bool,
        orig_size: u64,
        instance_remaining_size: option::Option<u64>,
        remaining_size: u64,
        is_reduce_only: bool,
        twap_start_time_s: u64,
        twap_frequency_s: u64,
        twap_end_time_s: u64,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        client_order_id: option::Option<string::String>,
    }
    struct ContinuedPendingOrder has copy, drop, store {
        order_args: perp_order::PerpOrderRequestExtendedArgs,
        order_metadata: perp_engine_types::OrderMetadata,
        remaining_size: u64,
    }
    enum AsyncMatchingEngine has key {
        V1 {
            pending_requests: big_ordered_map::BigOrderedMap<PendingRequestKey, PendingRequest>,
            async_matching_enabled: bool,
            pending_liquidations_in_queue: big_ordered_map::BigOrderedMap<address, bool>,
            margin_call_liquidations_in_queue: big_ordered_map::BigOrderedMap<address, bool>,
        }
    }
    enum PendingRequestKey has copy, drop, store {
        V1 {
            time: u64,
            priority: u8,
            tie_breaker: u128,
        }
    }
    struct MarginCallContinuationView has copy, drop {
        current_market: option::Option<object::Object<perp_market::PerpMarket>>,
        largest_slippage_tested: u64,
        markets_witnessed: vector<object::Object<perp_market::PerpMarket>>,
    }
    enum PendingRequestView has copy, drop {
        Order {
            _0: PendingOrder,
        }
        Twap {
            _0: PendingTwap,
        }
        ContinuedOrder {
            _0: ContinuedPendingOrder,
        }
        PendingLiquidation {
            user: address,
        }
        MarginCall {
            user: address,
            continuation: MarginCallContinuationView,
        }
        CheckADL,
        TriggerADL {
            adl_price: u64,
        }
        CommitMarkPrice {
            mark_px: u64,
        }
    }
    enum SystemPurgedOrderEvent has drop, store {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
            account: address,
            order_id: order_book_types::OrderId,
        }
    }
    enum TwapEvent has copy, drop, store {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
            account: address,
            is_buy: bool,
            order_id: order_book_types::OrderId,
            is_reduce_only: bool,
            start_time_s: u64,
            frequency_s: u64,
            duration_s: u64,
            orig_size: u64,
            remaining_size: u64,
            status: TwapOrderStatus,
            client_order_id: option::Option<string::String>,
        }
    }
    enum TwapOrderStatus has copy, drop, store {
        Open,
        Triggered {
            _0: order_book_types::OrderId,
            _1: u64,
        }
        Cancelled {
            _0: string::String,
        }
    }
    friend fun register_market(p0: &signer, p1: bool) {
        let _v0 = signer::address_of(p0);
        if (exists<AsyncMatchingEngine>(_v0)) abort 10;
        let _v1 = big_ordered_map::new_with_config<PendingRequestKey,PendingRequest>(0u16, 16u16, true);
        let _v2 = big_ordered_map::new_with_config<address,bool>(0u16, 16u16, true);
        let _v3 = big_ordered_map::new_with_config<address,bool>(0u16, 16u16, true);
        let _v4 = AsyncMatchingEngine::V1{pending_requests: _v1, async_matching_enabled: p1, pending_liquidations_in_queue: _v2, margin_call_liquidations_in_queue: _v3};
        move_to<AsyncMatchingEngine>(p0, _v4);
    }
    friend fun add_adl_to_pending(p0: object::Object<perp_market::PerpMarket>)
        acquires AsyncMatchingEngine
    {
        let _v0 = transaction_context::monotonically_increasing_counter();
        let _v1 = PendingRequestKey::V1{time: 0, priority: 0u8, tie_breaker: _v0};
        let _v2 = p0;
        let _v3 = object::object_address<perp_market::PerpMarket>(&_v2);
        let _v4 = &mut borrow_global_mut<AsyncMatchingEngine>(_v3).pending_requests;
        let _v5 = PendingRequest::CheckADL{};
        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v4, _v1, _v5);
    }
    fun add_taker_order_to_pending(p0: object::Object<perp_market::PerpMarket>, p1: perp_order::PerpOrderRequestExtendedArgs, p2: bool, p3: option::Option<perp_engine_types::ChildTpSlOrder>, p4: option::Option<perp_engine_types::ChildTpSlOrder>, p5: option::Option<builder_code_registry::BuilderCode>)
        acquires AsyncMatchingEngine
    {
        let _v0 = decibel_time::now_microseconds() + 1;
        let _v1 = transaction_context::monotonically_increasing_counter();
        let _v2 = PendingRequestKey::V1{time: _v0, priority: 2u8, tie_breaker: _v1};
        let _v3 = option::none<perp_engine_types::TwapMetadata>();
        let _v4 = perp_engine_types::new_order_metadata(p2, _v3, p3, p4, p5);
        let _v5 = PendingOrder{order_args: p1, order_metadata: _v4};
        let _v6 = p0;
        let _v7 = object::object_address<perp_market::PerpMarket>(&_v6);
        let _v8 = &mut borrow_global_mut<AsyncMatchingEngine>(_v7).pending_requests;
        let _v9 = PendingRequest::Order{_0: _v5};
        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v8, _v2, _v9);
    }
    friend fun cancel_twap_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: order_book_types::OrderId) {
        let _v0 = signer::address_of(p1);
        let _v1 = market_types::order_cancellation_reason_cancelled_by_user();
        let _v2 = string::utf8(vector[]);
        let _v3 = clearinghouse_perp::market_callbacks(p0);
        let _v4 = &_v3;
        let (_v5,_v6) = single_order_types::destroy_single_order<perp_engine_types::OrderMetadata>(perp_market::cancel_order(p0, _v0, p2, false, _v1, _v2, _v4));
        let (_v7,_v8,_v9,_v10,_v11,_v12,_v13,_v14,_v15,_v16,_v17) = single_order_types::destroy_single_order_request<perp_engine_types::OrderMetadata>(_v5);
        let _v18 = _v17;
        let (_v19,_v20,_v21) = perp_engine_types::get_twap_from_metadata(&_v18);
        let _v22 = perp_engine_types::is_reduce_only(&_v18);
        let _v23 = _v19;
        let _v24 = _v21 - _v23;
        let _v25 = TwapOrderStatus::Cancelled{_0: string::utf8(vector[67u8, 97u8, 110u8, 99u8, 101u8, 108u8, 108u8, 101u8, 100u8, 32u8, 98u8, 121u8, 32u8, 117u8, 115u8, 101u8, 114u8])};
        let _v26 = option::none<string::String>();
        event::emit<TwapEvent>(TwapEvent::V1{market: p0, account: _v7, is_buy: _v13, order_id: _v8, is_reduce_only: _v22, start_time_s: _v23, frequency_s: _v20, duration_s: _v24, orig_size: _v11, remaining_size: 0, status: _v25, client_order_id: _v26});
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
                    if (_v7 is PendingLiquidation) {
                        let PendingRequest::PendingLiquidation{user: _v8} = _v6;
                        let _v9 = _v8;
                        let _v10 = &mut _v2.pending_liquidations_in_queue;
                        let _v11 = &_v9;
                        let _v12 = big_ordered_map::remove<address,bool>(_v10, _v11);
                        continue
                    };
                    if (_v7 is MarginCall) {
                        let PendingRequest::MarginCall{user: _v13, continuation: _v14} = _v6;
                        let _v15 = _v13;
                        liquidation::destroy_continuation(_v14);
                        let _v16 = &mut _v2.margin_call_liquidations_in_queue;
                        let _v17 = &_v15;
                        let _v18 = big_ordered_map::remove<address,bool>(_v16, _v17);
                        continue
                    };
                    if (_v7 is CheckADL) {
                        let PendingRequest::CheckADL{} = _v6;
                        continue
                    };
                    if (_v7 is TriggerADL) {
                        let PendingRequest::TriggerADL{adl_price: _v19} = _v6;
                        continue
                    };
                    if (_v7 is CommitMarkPrice) {
                        let PendingRequest::CommitMarkPrice{mark_px: _v20} = _v6;
                        continue
                    };
                    if (_v7 is Twap) {
                        let PendingRequest::Twap{_0: _v21} = _v6;
                        let _v22 = _v21;
                        let _v23 = *&(&_v22).account;
                        let _v24 = *&(&_v22).order_id;
                        event::emit<SystemPurgedOrderEvent>(SystemPurgedOrderEvent::V1{market: p0, account: _v23, order_id: _v24});
                        continue
                    };
                    if (_v7 is Order) {
                        let PendingRequest::Order{_0: _v25} = _v6;
                        let _v26 = _v25;
                        let _v27 = perp_order::get_user(&(&_v26).order_args);
                        let _v28 = perp_order::get_order_id(&(&_v26).order_args);
                        event::emit<SystemPurgedOrderEvent>(SystemPurgedOrderEvent::V1{market: p0, account: _v27, order_id: _v28});
                        continue
                    };
                    if (!(_v7 is ContinuedOrder)) break;
                    let PendingRequest::ContinuedOrder{_0: _v29} = _v6;
                    let _v30 = _v29;
                    let _v31 = perp_order::get_user(&(&_v30).order_args);
                    let _v32 = perp_order::get_order_id(&(&_v30).order_args);
                    event::emit<SystemPurgedOrderEvent>(SystemPurgedOrderEvent::V1{market: p0, account: _v31, order_id: _v32});
                    continue
                };
                abort 14566554180833181697
            };
            return ()
        };
    }
    friend fun get_async_queue_length(p0: object::Object<perp_market::PerpMarket>): u64
        acquires AsyncMatchingEngine
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        if (!exists<AsyncMatchingEngine>(_v0)) return 0;
        big_ordered_map::compute_length<PendingRequestKey,PendingRequest>(&borrow_global<AsyncMatchingEngine>(_v0).pending_requests)
    }
    fun get_first_n_from_address_queue(p0: &big_ordered_map::BigOrderedMap<address, bool>, p1: u64): (vector<address>, vector<bool>) {
        let _v0 = vector::empty<address>();
        let _v1 = vector::empty<bool>();
        let _v2 = big_ordered_map::internal_new_begin_iter<address,bool>(p0);
        let _v3 = 0;
        loop {
            let _v4;
            if (big_ordered_map::iter_is_end<address,bool>(&_v2, p0)) _v4 = false else _v4 = _v3 < p1;
            if (!_v4) break;
            let _v5 = *big_ordered_map::iter_borrow_key<address>(&_v2);
            let _v6 = *big_ordered_map::iter_borrow<address,bool>(_v2, p0);
            vector::push_back<address>(&mut _v0, _v5);
            vector::push_back<bool>(&mut _v1, _v6);
            _v2 = big_ordered_map::iter_next<address,bool>(_v2, p0);
            _v3 = _v3 + 1;
            continue
        };
        (_v0, _v1)
    }
    fun get_nth_from_address_queue(p0: &big_ordered_map::BigOrderedMap<address, bool>, p1: u64): (option::Option<address>, option::Option<bool>) {
        let _v0 = big_ordered_map::internal_new_begin_iter<address,bool>(p0);
        let _v1 = 0;
        'l0: loop {
            loop {
                if (big_ordered_map::iter_is_end<address,bool>(&_v0, p0)) break 'l0;
                if (_v1 == p1) break;
                _v0 = big_ordered_map::iter_next<address,bool>(_v0, p0);
                _v1 = _v1 + 1
            };
            let _v2 = *big_ordered_map::iter_borrow_key<address>(&_v0);
            let _v3 = *big_ordered_map::iter_borrow<address,bool>(_v0, p0);
            let _v4 = option::some<address>(_v2);
            let _v5 = option::some<bool>(_v3);
            return (_v4, _v5)
        };
        let _v6 = option::none<address>();
        let _v7 = option::none<bool>();
        (_v6, _v7)
    }
    fun pending_request_to_view(p0: &PendingRequest): PendingRequestView {
        'l5: loop {
            'l4: loop {
                'l3: loop {
                    'l2: loop {
                        'l1: loop {
                            'l0: loop {
                                loop {
                                    if (!(p0 is Order)) {
                                        if (p0 is Twap) break;
                                        if (p0 is ContinuedOrder) break 'l0;
                                        if (p0 is PendingLiquidation) break 'l1;
                                        if (p0 is MarginCall) break 'l2;
                                        if (p0 is CheckADL) break 'l3;
                                        if (p0 is TriggerADL) break 'l4;
                                        if (p0 is CommitMarkPrice) break 'l5;
                                        abort 14566554180833181697
                                    };
                                    return PendingRequestView::Order{_0: *&p0._0}
                                };
                                return PendingRequestView::Twap{_0: *&p0._0}
                            };
                            return PendingRequestView::ContinuedOrder{_0: *&p0._0}
                        };
                        return PendingRequestView::PendingLiquidation{user: *&p0.user}
                    };
                    let _v0 = &p0.user;
                    let _v1 = &p0.continuation;
                    let _v2 = *_v0;
                    let _v3 = liquidation::get_continuation_current_market(_v1);
                    let _v4 = liquidation::get_continuation_largest_slippage_tested(_v1);
                    let _v5 = liquidation::get_continuation_markets_witnessed(_v1);
                    let _v6 = MarginCallContinuationView{current_market: _v3, largest_slippage_tested: _v4, markets_witnessed: _v5};
                    return PendingRequestView::MarginCall{user: _v2, continuation: _v6}
                };
                return PendingRequestView::CheckADL{}
            };
            return PendingRequestView::TriggerADL{adl_price: *&p0.adl_price}
        };
        PendingRequestView::CommitMarkPrice{mark_px: *&p0.mark_px}
    }
    friend fun place_maker_or_queue_taker(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: perp_order::PerpOrderRequestCommonArgs, p3: option::Option<order_book_types::OrderId>, p4: bool, p5: option::Option<u64>, p6: perp_order::PerpOrderRequestTpSlArgs, p7: option::Option<builder_code_registry::BuilderCode>): order_book_types::OrderId
        acquires AsyncMatchingEngine
    {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        let _v4 = perp_order::get_is_buy(&p2);
        let _v5 = perp_order::get_price(&p2);
        let (_v6,_v7,_v8,_v9) = perp_order::tpsl_into_inner(p6);
        if (option::is_none<order_book_types::OrderId>(&p3)) {
            _v2 = order_book_types::next_order_id();
            _v1 = true
        } else {
            _v2 = option::destroy_some<order_book_types::OrderId>(p3);
            _v1 = false
        };
        let (_v10,_v11) = tp_sl_utils::validate_and_get_child_tp_sl_orders(p0, _v2, _v4, _v6, _v7, _v8, _v9);
        let _v12 = _v11;
        let _v13 = _v10;
        if (option::is_some<perp_engine_types::ChildTpSlOrder>(&_v13)) _v0 = true else _v0 = option::is_some<perp_engine_types::ChildTpSlOrder>(&_v12);
        if (_v0) {
            if (p4) abort 12;
            assert!(option::is_none<u64>(&p5), 13)
        };
        if (option::is_some<builder_code_registry::BuilderCode>(&p7)) {
            let _v14 = option::borrow<builder_code_registry::BuilderCode>(&p7);
            builder_code_registry::validate_builder_code(p1, _v14)
        };
        if (option::is_some<u64>(&p5)) {
            let _v15 = price_management::get_mark_price(p0);
            let _v16 = option::destroy_some<u64>(p5);
            if (_v4) {
                assert!(_v15 < _v16, 14);
                _v3 = option::some<order_book_types::TriggerCondition>(order_book_types::price_move_up_condition(_v16))
            } else if (_v15 > _v16) _v3 = option::some<order_book_types::TriggerCondition>(order_book_types::price_move_down_condition(_v16)) else abort 14
        } else _v3 = option::none<order_book_types::TriggerCondition>();
        let _v17 = perp_order::new_order_extended_args(p1, p2, _v2, _v3);
        if (_v1) {
            let _v18 = &_v17;
            let _v19 = perp_order::get_orig_size(&p2);
            let _v20 = perp_order::get_orig_size(&p2);
            let _v21 = market_types::order_status_acknowledged();
            let _v22 = string::utf8(vector[]);
            let _v23 = option::none<perp_engine_types::TwapMetadata>();
            let _v24 = perp_engine_types::new_order_metadata(p4, _v23, _v13, _v12, p7);
            let _v25 = clearinghouse_perp::market_callbacks(p0);
            let _v26 = &_v25;
            perp_market::emit_event_for_order(p0, _v18, _v19, _v20, true, _v21, _v22, _v24, _v26)
        };
        if (perp_market::is_taker_order(p0, _v5, _v4, _v3)) add_taker_order_to_pending(p0, _v17, p4, _v13, _v12, p7) else {
            let _v27 = perp_order::get_orig_size(perp_order::get_common_args(&_v17));
            let _v28 = option::none<perp_engine_types::TwapMetadata>();
            let _v29 = perp_engine_types::new_order_metadata(p4, _v28, _v13, _v12, p7);
            let _v30 = work_unit_utils::get_default_work_units();
            let _v31 = &mut _v30;
            let (_v32,_v33,_v34,_v35) = order_placement_utils::place_order_and_trigger_matching_actions(p0, _v17, _v27, _v29, true, _v31);
            if (_v35 == 0u32) () else abort 23
        };
        _v2
    }
    friend fun place_twap_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: u64, p3: bool, p4: bool, p5: option::Option<string::String>, p6: u64, p7: u64, p8: option::Option<builder_code_registry::BuilderCode>): order_book_types::OrderId {
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
        let _v13 = perp_order::new_order_common_args(_v4, p2, p3, _v12, p5);
        let _v14 = option::some<order_book_types::TriggerCondition>(order_book_types::new_time_based_trigger_condition(decibel_time::now_seconds()));
        let _v15 = perp_order::new_order_extended_args(_v11, _v13, _v10, _v14);
        let _v16 = work_unit_utils::get_finish_or_abort_work_units();
        let _v17 = &_v16;
        let _v18 = clearinghouse_perp::market_callbacks(p0);
        let _v19 = &_v18;
        let _v20 = perp_market::place_order_with_order_id(p0, _v15, p2, _v9, _v17, true, true, _v19);
        let _v21 = signer::address_of(p1);
        let _v22 = TwapOrderStatus::Open{};
        event::emit<TwapEvent>(TwapEvent::V1{market: p0, account: _v21, is_buy: p3, order_id: _v10, is_reduce_only: p4, start_time_s: _v2, frequency_s: p6, duration_s: p7, orig_size: p2, remaining_size: p2, status: _v22, client_order_id: p5});
        _v10
    }
    fun place_twap_order_helper(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: order_book_types::OrderId, p3: u64, p4: u64, p5: bool, p6: bool, p7: u64, p8: u64, p9: u64, p10: option::Option<string::String>, p11: option::Option<builder_code_registry::BuilderCode>) {
        let _v0;
        if (p5) _v0 = 9223372036854775807 else _v0 = 1;
        let _v1 = order_book_types::immediate_or_cancel();
        let _v2 = perp_order::new_order_common_args(_v0, p3, p5, _v1, p10);
        let _v3 = option::some<order_book_types::TriggerCondition>(order_book_types::new_time_based_trigger_condition(decibel_time::now_seconds() + p8));
        let _v4 = perp_order::new_order_extended_args(p1, _v2, p2, _v3);
        let _v5 = option::some<perp_engine_types::TwapMetadata>(perp_engine_types::new_twap_metadata(p7, p8, p9));
        let _v6 = option::none<perp_engine_types::ChildTpSlOrder>();
        let _v7 = option::none<perp_engine_types::ChildTpSlOrder>();
        let _v8 = perp_engine_types::new_order_metadata(p6, _v5, _v6, _v7, p11);
        let _v9 = work_unit_utils::get_finish_or_abort_work_units();
        let _v10 = &_v9;
        let _v11 = clearinghouse_perp::market_callbacks(p0);
        let _v12 = &_v11;
        let _v13 = perp_market::place_order_with_order_id(p0, _v4, p4, _v8, _v10, true, true, _v12);
    }
    friend fun schedule_commit_mark_price(p0: object::Object<perp_market::PerpMarket>, p1: u64)
        acquires AsyncMatchingEngine
    {
        let _v0 = transaction_context::monotonically_increasing_counter();
        let _v1 = PendingRequestKey::V1{time: 0, priority: 0u8, tie_breaker: _v0};
        let _v2 = p0;
        let _v3 = object::object_address<perp_market::PerpMarket>(&_v2);
        let _v4 = &mut borrow_global_mut<AsyncMatchingEngine>(_v3).pending_requests;
        let _v5 = PendingRequest::CommitMarkPrice{mark_px: p1};
        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v4, _v1, _v5);
    }
    friend fun schedule_liquidation(p0: address, p1: object::Object<perp_market::PerpMarket>)
        acquires AsyncMatchingEngine
    {
        let _v0 = accounts_collateral::backstop_liquidator();
        if (!(p0 != _v0)) {
            let _v1 = error::invalid_argument(22);
            abort _v1
        };
        let _v2 = p1;
        let _v3 = object::object_address<perp_market::PerpMarket>(&_v2);
        let _v4 = &borrow_global_mut<AsyncMatchingEngine>(_v3).pending_liquidations_in_queue;
        let _v5 = &p0;
        if (big_ordered_map::contains<address,bool>(_v4, _v5)) return ();
        let _v6 = p1;
        let _v7 = object::object_address<perp_market::PerpMarket>(&_v6);
        big_ordered_map::add<address,bool>(&mut borrow_global_mut<AsyncMatchingEngine>(_v7).pending_liquidations_in_queue, p0, true);
        let _v8 = transaction_context::monotonically_increasing_counter();
        let _v9 = PendingRequestKey::V1{time: 0, priority: 0u8, tie_breaker: _v8};
        let _v10 = p1;
        let _v11 = object::object_address<perp_market::PerpMarket>(&_v10);
        let _v12 = &mut borrow_global_mut<AsyncMatchingEngine>(_v11).pending_requests;
        let _v13 = PendingRequest::PendingLiquidation{user: p0};
        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v12, _v9, _v13);
    }
    friend fun trigger_matching(p0: object::Object<perp_market::PerpMarket>, p1: work_unit_utils::WorkUnit)
        acquires AsyncMatchingEngine
    {
        trigger_matching_internal(p0, p1);
    }
    fun trigger_matching_internal(p0: object::Object<perp_market::PerpMarket>, p1: work_unit_utils::WorkUnit)
        acquires AsyncMatchingEngine
    {
        let _v0 = p0;
        let _v1 = object::object_address<perp_market::PerpMarket>(&_v0);
        let _v2 = borrow_global_mut<AsyncMatchingEngine>(_v1);
        let _v3 = decibel_time::now_microseconds();
        let _v4 = true;
        assert!(work_unit_utils::has_more_work(&p1), 16);
        loop {
            let _v5 = &mut p1;
            if (!trigger_matching_one_action_internal(_v2, p0, _v3, _v4, _v5)) break;
            _v4 = false;
            continue
        };
    }
    fun trigger_matching_one_action_internal(p0: &mut AsyncMatchingEngine, p1: object::Object<perp_market::PerpMarket>, p2: u64, p3: bool, p4: &mut work_unit_utils::WorkUnit): bool {
        let _v0;
        if (big_ordered_map::is_empty<PendingRequestKey,PendingRequest>(&p0.pending_requests)) _v0 = false else _v0 = work_unit_utils::has_more_work(freeze(p4));
        if (_v0) {
            let _v1;
            let _v2;
            let (_v3,_v4) = big_ordered_map::borrow_front<PendingRequestKey,PendingRequest>(&p0.pending_requests);
            let _v5 = _v4;
            let _v6 = _v3;
            if (*&p0.async_matching_enabled) _v1 = *&(&_v6).time > p2 else _v1 = false;
            'l0: loop {
                loop {
                    if (!_v1) {
                        let _v7;
                        let _v8;
                        let _v9;
                        let _v10;
                        let _v11;
                        let _v12;
                        let _v13;
                        if (p3) accounts_collateral::set_market_to_reduce_only_if_oracle_stale(p1);
                        let _v14 = &mut p0.pending_requests;
                        let _v15 = &_v6;
                        let _v16 = big_ordered_map::remove<PendingRequestKey,PendingRequest>(_v14, _v15);
                        _v5 = &_v16;
                        if (_v5 is Order) {
                            let PendingRequest::Order{_0: _v17} = _v16;
                            let PendingOrder{order_args: _v18, order_metadata: _v19} = _v17;
                            _v13 = _v19;
                            let _v20 = _v18;
                            let _v21 = perp_order::get_orig_size(perp_order::get_common_args(&_v20));
                            let (_v22,_v23,_v24,_v25) = order_placement_utils::place_order_and_trigger_matching_actions(p1, _v20, _v21, _v13, true, p4);
                            let _v26 = _v23;
                            _v12 = _v22;
                            if (option::is_some<market_types::OrderCancellationReason>(&_v26)) _v11 = order_placement::is_fill_limit_violation(option::destroy_some<market_types::OrderCancellationReason>(_v26)) else _v11 = false;
                            if (_v11) _v10 = _v12 > 0 else _v10 = false;
                            if (_v10) {
                                _v9 = ContinuedPendingOrder{order_args: _v20, order_metadata: _v13, remaining_size: _v12};
                                let _v27 = &mut p0.pending_requests;
                                let _v28 = PendingRequest::ContinuedOrder{_0: _v9};
                                big_ordered_map::add<PendingRequestKey,PendingRequest>(_v27, _v6, _v28);
                                break
                            };
                            break
                        };
                        if (_v5 is Twap) {
                            let PendingRequest::Twap{_0: _v29} = _v16;
                            trigger_pending_twap_instance(p1, p0, _v29, p4, _v6);
                            break
                        };
                        if (_v5 is ContinuedOrder) {
                            let PendingRequest::ContinuedOrder{_0: _v30} = _v16;
                            let ContinuedPendingOrder{order_args: _v31, order_metadata: _v32, remaining_size: _v33} = _v30;
                            _v12 = _v33;
                            _v13 = _v32;
                            let _v34 = _v31;
                            let (_v35,_v36,_v37,_v38) = order_placement_utils::place_order_and_trigger_matching_actions(p1, _v34, _v12, _v13, false, p4);
                            let _v39 = _v36;
                            _v12 = _v35;
                            if (option::is_some<market_types::OrderCancellationReason>(&_v39)) _v11 = order_placement::is_fill_limit_violation(option::destroy_some<market_types::OrderCancellationReason>(_v39)) else _v11 = false;
                            if (_v11) _v10 = _v12 > 0 else _v10 = false;
                            if (_v10) {
                                _v9 = ContinuedPendingOrder{order_args: _v34, order_metadata: _v13, remaining_size: _v12};
                                let _v40 = &mut p0.pending_requests;
                                let _v41 = PendingRequest::ContinuedOrder{_0: _v9};
                                big_ordered_map::add<PendingRequestKey,PendingRequest>(_v40, _v6, _v41);
                                break
                            };
                            break
                        };
                        if (_v5 is PendingLiquidation) {
                            let PendingRequest::PendingLiquidation{user: _v42} = _v16;
                            _v2 = _v42;
                            if (!perp_positions::has_position(_v2, p1)) break 'l0;
                            work_unit_utils::consume_small_work_units(p4);
                            let _v43 = accounts_collateral::position_status(_v2, p1);
                            work_unit_utils::consume_small_work_units(p4);
                            if (perp_positions::is_account_liquidatable_detailed(&_v43, true)) {
                                liquidation::trigger_backstop_liquidation_internal(p1, _v2, p4);
                                work_unit_utils::consume_small_work_units(p4)
                            } else {
                                let _v44;
                                if (perp_positions::is_account_liquidatable_detailed(&_v43, false)) {
                                    let _v45 = &p0.margin_call_liquidations_in_queue;
                                    let _v46 = &_v2;
                                    _v44 = !big_ordered_map::contains<address,bool>(_v45, _v46)
                                } else _v44 = false;
                                if (_v44) {
                                    work_unit_utils::consume_small_work_units(p4);
                                    let _v47 = &mut p0.pending_requests;
                                    _v8 = transaction_context::monotonically_increasing_counter();
                                    let _v48 = PendingRequestKey::V1{time: p2, priority: 1u8, tie_breaker: _v8};
                                    let _v49 = liquidation::default_margin_call_continuation();
                                    let _v50 = PendingRequest::MarginCall{user: _v2, continuation: _v49};
                                    big_ordered_map::add<PendingRequestKey,PendingRequest>(_v47, _v48, _v50);
                                    big_ordered_map::add<address,bool>(&mut p0.margin_call_liquidations_in_queue, _v2, true)
                                }
                            };
                            let _v51 = &mut p0.pending_liquidations_in_queue;
                            let _v52 = &_v2;
                            let _v53 = big_ordered_map::remove<address,bool>(_v51, _v52);
                            work_unit_utils::consume_small_work_units(p4);
                            break
                        };
                        if (_v5 is MarginCall) {
                            let PendingRequest::MarginCall{user: _v54, continuation: _v55} = _v16;
                            let _v56 = _v55;
                            let _v57 = _v54;
                            let _v58 = &mut _v56;
                            let _v59 = liquidation::trigger_margin_call_internal(p1, _v57, _v58, p4);
                            if (liquidation::margin_call_result_needs_backstop_liquidation(&_v59)) {
                                let _v60 = &mut p0.pending_requests;
                                _v8 = transaction_context::monotonically_increasing_counter();
                                let _v61 = PendingRequestKey::V1{time: 0, priority: 0u8, tie_breaker: _v8};
                                let _v62 = PendingRequest::PendingLiquidation{user: _v57};
                                big_ordered_map::add<PendingRequestKey,PendingRequest>(_v60, _v61, _v62);
                                let _v63 = &mut p0.pending_requests;
                                _v8 = transaction_context::monotonically_increasing_counter();
                                let _v64 = PendingRequestKey::V1{time: 0, priority: 0u8, tie_breaker: _v8};
                                let _v65 = PendingRequest::CheckADL{};
                                big_ordered_map::add<PendingRequestKey,PendingRequest>(_v63, _v64, _v65);
                                big_ordered_map::add<address,bool>(&mut p0.pending_liquidations_in_queue, _v57, true);
                                let _v66 = &mut p0.margin_call_liquidations_in_queue;
                                let _v67 = &_v57;
                                let _v68 = big_ordered_map::remove<address,bool>(_v66, _v67);
                                liquidation::destroy_continuation(_v56);
                                break
                            };
                            if (liquidation::margin_call_result_uses_continuation(&_v59)) {
                                let _v69 = &mut p0.pending_requests;
                                let _v70 = PendingRequest::MarginCall{user: _v57, continuation: _v56};
                                big_ordered_map::add<PendingRequestKey,PendingRequest>(_v69, _v6, _v70);
                                break
                            };
                            liquidation::destroy_continuation(_v56);
                            let _v71 = &mut p0.margin_call_liquidations_in_queue;
                            let _v72 = &_v57;
                            let _v73 = big_ordered_map::remove<address,bool>(_v71, _v72);
                            break
                        };
                        if (_v5 is CheckADL) {
                            let PendingRequest::CheckADL{} = _v16;
                            work_unit_utils::consume_small_work_units(p4);
                            _v12 = price_management::get_mark_price(p1);
                            _v7 = perp_market_config::get_adl_trigger_threshold(p1);
                            let _v74 = backstop_liquidator_profit_tracker::should_trigger_adl(p1, _v12, _v7);
                            if (option::is_some<u64>(&_v74)) {
                                _v12 = option::destroy_some<u64>(_v74);
                                let _v75 = &mut p0.pending_requests;
                                let _v76 = PendingRequest::TriggerADL{adl_price: _v12};
                                big_ordered_map::add<PendingRequestKey,PendingRequest>(_v75, _v6, _v76);
                                break
                            };
                            break
                        };
                        if (_v5 is TriggerADL) {
                            let PendingRequest::TriggerADL{adl_price: _v77} = _v16;
                            _v12 = _v77;
                            _v7 = perp_positions::get_position_size(accounts_collateral::backstop_liquidator(), p1);
                            if (liquidation::trigger_adl_internal(p1, _v7, _v12, p4)) {
                                let _v78 = &mut p0.pending_requests;
                                let _v79 = PendingRequest::TriggerADL{adl_price: _v12};
                                big_ordered_map::add<PendingRequestKey,PendingRequest>(_v78, _v6, _v79);
                                break
                            };
                            break
                        };
                        assert!(_v5 is CommitMarkPrice, 14566554180833181697);
                        let PendingRequest::CommitMarkPrice{mark_px: _v80} = _v16;
                        work_unit_utils::consume_small_work_units(p4);
                        let (_v81,_v82) = price_management::into_old_and_new_market_state(price_management::commit_mark_price(p1, _v80));
                        perp_positions::update_account_status_cache_on_market_state_change(p1, _v81, _v82);
                        break
                    };
                    return false
                };
                work_unit_utils::consume_small_work_units(p4);
                return true
            };
            work_unit_utils::consume_small_work_units(p4);
            let _v83 = &mut p0.pending_liquidations_in_queue;
            let _v84 = &_v2;
            let _v85 = big_ordered_map::remove<address,bool>(_v83, _v84);
            return true
        };
        false
    }
    fun trigger_pending_twap_instance(p0: object::Object<perp_market::PerpMarket>, p1: &mut AsyncMatchingEngine, p2: PendingTwap, p3: &mut work_unit_utils::WorkUnit, p4: PendingRequestKey) {
        let _v0;
        let _v1;
        work_unit_utils::consume_small_work_units(p3);
        let PendingTwap{account: _v2, order_id: _v3, is_buy: _v4, orig_size: _v5, instance_remaining_size: _v6, remaining_size: _v7, is_reduce_only: _v8, twap_start_time_s: _v9, twap_frequency_s: _v10, twap_end_time_s: _v11, builder_code: _v12, client_order_id: _v13} = p2;
        let _v14 = _v13;
        let _v15 = _v12;
        let _v16 = _v11;
        let _v17 = _v10;
        let _v18 = _v9;
        let _v19 = _v8;
        let _v20 = _v7;
        let _v21 = _v6;
        let _v22 = _v5;
        let _v23 = _v4;
        let _v24 = _v3;
        let _v25 = _v2;
        let _v26 = decibel_time::now_seconds();
        if (_v26 >= _v16) _v0 = 1 else {
            let _v27 = _v16 - _v26;
            let _v28 = _v17 / 2;
            _v0 = (_v27 + _v28) / _v17 + 1
        };
        let _v29 = perp_market_config::get_lot_size(p0);
        let _v30 = perp_market_config::get_min_size(p0);
        if (option::is_some<u64>(&_v21)) _v1 = _v0 > 1 else _v1 = false;
        loop {
            let _v31;
            let _v32;
            if (_v1) _v32 = option::destroy_some<u64>(_v21) else {
                _v31 = _v20 / _v0 / _v29 * _v29;
                if (_v31 < _v30) break else _v32 = _v31
            };
            let _v33 = perp_market::get_slippage_price(p0, _v23, 300);
            let _v34 = option::is_none<u64>(&_v33);
            'l1: loop {
                let _v35;
                'l2: loop {
                    let _v36;
                    'l0: loop {
                        loop {
                            if (!_v34) {
                                let _v37;
                                let _v38;
                                let _v39;
                                let _v40;
                                let _v41;
                                let _v42 = option::destroy_some<u64>(_v33);
                                let _v43 = perp_market_config::round_price_to_ticker(p0, _v42, _v23);
                                let _v44 = order_book_types::next_order_id();
                                let _v45 = order_book_types::immediate_or_cancel();
                                let _v46 = option::none<string::String>();
                                let _v47 = perp_order::new_order_common_args(_v43, _v22, _v23, _v45, _v46);
                                let _v48 = option::none<order_book_types::TriggerCondition>();
                                let _v49 = perp_order::new_order_extended_args(_v25, _v47, _v44, _v48);
                                let _v50 = option::some<perp_engine_types::TwapMetadata>(perp_engine_types::new_twap_metadata(_v18, _v17, _v16));
                                let _v51 = option::none<perp_engine_types::ChildTpSlOrder>();
                                let _v52 = option::none<perp_engine_types::ChildTpSlOrder>();
                                let _v53 = perp_engine_types::new_order_metadata(_v19, _v50, _v51, _v52, _v15);
                                let (_v54,_v55,_v56,_v57) = order_placement_utils::place_order_and_trigger_matching_actions(p0, _v49, _v32, _v53, true, p3);
                                let _v58 = _v55;
                                _v31 = 0;
                                let _v59 = _v56;
                                vector::reverse<u64>(&mut _v59);
                                let _v60 = _v59;
                                _v35 = vector::length<u64>(&_v60);
                                while (_v35 > 0) {
                                    _v40 = vector::pop_back<u64>(&mut _v60);
                                    _v31 = _v31 + _v40;
                                    _v35 = _v35 - 1
                                };
                                vector::destroy_empty<u64>(_v60);
                                let _v61 = _v16 - _v18;
                                let _v62 = _v20 - _v31;
                                let _v63 = TwapOrderStatus::Triggered{_0: _v44, _1: _v31};
                                event::emit<TwapEvent>(TwapEvent::V1{market: p0, account: _v25, is_buy: _v23, order_id: _v24, is_reduce_only: _v19, start_time_s: _v18, frequency_s: _v17, duration_s: _v61, orig_size: _v22, remaining_size: _v62, status: _v63, client_order_id: _v14});
                                _v35 = _v20 - _v31;
                                _v31 = (_v32 - _v31) / _v29 * _v29;
                                if (option::is_some<market_types::OrderCancellationReason>(&_v58)) _v41 = order_placement::is_fill_limit_violation(option::destroy_some<market_types::OrderCancellationReason>(_v58)) else _v41 = false;
                                if (_v41) _v39 = _v31 >= _v30 else _v39 = false;
                                if (_v39) break;
                                _v40 = _v0 - 1;
                                if (option::is_none<market_types::OrderCancellationReason>(&_v58)) _v38 = true else _v38 = order_placement::is_ioc_violation(option::destroy_some<market_types::OrderCancellationReason>(_v58));
                                if (_v38) if (_v35 < _v30) _v37 = _v35 > 0 else _v37 = false else _v37 = true;
                                if (_v37) {
                                    if (!_v38) {
                                        _v36 = string::utf8(vector[83u8, 117u8, 98u8, 32u8, 111u8, 114u8, 100u8, 101u8, 114u8, 32u8, 102u8, 97u8, 105u8, 108u8, 101u8, 100u8]);
                                        break 'l0
                                    };
                                    _v36 = string::utf8(vector[82u8, 101u8, 109u8, 97u8, 105u8, 110u8, 105u8, 110u8, 103u8, 32u8, 115u8, 105u8, 122u8, 101u8, 32u8, 115u8, 109u8, 97u8, 108u8, 108u8, 101u8, 114u8, 32u8, 116u8, 104u8, 97u8, 110u8, 32u8, 109u8, 97u8, 114u8, 107u8, 101u8, 116u8, 32u8, 109u8, 105u8, 110u8, 32u8, 115u8, 105u8, 122u8, 101u8]);
                                    break 'l0
                                };
                                if (!(_v40 != 0)) break 'l1;
                                break 'l2
                            };
                            let _v64 = _v16 - _v18;
                            let _v65 = TwapOrderStatus::Triggered{_0: _v24, _1: 0};
                            event::emit<TwapEvent>(TwapEvent::V1{market: p0, account: _v25, is_buy: _v23, order_id: _v24, is_reduce_only: _v19, start_time_s: _v18, frequency_s: _v17, duration_s: _v64, orig_size: _v22, remaining_size: _v20, status: _v65, client_order_id: _v14});
                            let _v66 = option::none<string::String>();
                            place_twap_order_helper(p0, _v25, _v24, _v22, _v20, _v23, _v19, _v18, _v17, _v16, _v66, _v15);
                            return ()
                        };
                        let _v67 = option::some<u64>(_v31);
                        p2 = PendingTwap{account: _v25, order_id: _v24, is_buy: _v23, orig_size: _v22, instance_remaining_size: _v67, remaining_size: _v35, is_reduce_only: _v19, twap_start_time_s: _v18, twap_frequency_s: _v17, twap_end_time_s: _v16, builder_code: _v15, client_order_id: _v14};
                        let _v68 = &mut p1.pending_requests;
                        let _v69 = PendingRequest::Twap{_0: p2};
                        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v68, p4, _v69);
                        return ()
                    };
                    let _v70 = _v16 - _v18;
                    let _v71 = TwapOrderStatus::Cancelled{_0: _v36};
                    event::emit<TwapEvent>(TwapEvent::V1{market: p0, account: _v25, is_buy: _v23, order_id: _v24, is_reduce_only: _v19, start_time_s: _v18, frequency_s: _v17, duration_s: _v70, orig_size: _v22, remaining_size: 0, status: _v71, client_order_id: _v14});
                    return ()
                };
                let _v72 = option::none<string::String>();
                place_twap_order_helper(p0, _v25, _v24, _v22, _v35, _v23, _v19, _v18, _v17, _v16, _v72, _v15);
                return ()
            };
            return ()
        };
        let _v73 = _v16 - _v18;
        let _v74 = TwapOrderStatus::Triggered{_0: _v24, _1: 0};
        event::emit<TwapEvent>(TwapEvent::V1{market: p0, account: _v25, is_buy: _v23, order_id: _v24, is_reduce_only: _v19, start_time_s: _v18, frequency_s: _v17, duration_s: _v73, orig_size: _v22, remaining_size: _v20, status: _v74, client_order_id: _v14});
        place_twap_order_helper(p0, _v25, _v24, _v22, _v20, _v23, _v19, _v18, _v17, _v16, _v14, _v15);
    }
    friend fun trigger_matching_sometimes(p0: object::Object<perp_market::PerpMarket>, p1: work_unit_utils::WorkUnit)
        acquires AsyncMatchingEngine
    {
        if (transaction_context::monotonically_increasing_counter() % 3u128 == 0u128) {
            trigger_matching_internal(p0, p1);
            return ()
        };
    }
    friend fun trigger_price_based_conditional_orders(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: &mut work_unit_utils::WorkUnit)
        acquires AsyncMatchingEngine
    {
        let _v0 = work_unit_utils::get_max_order_placement_limit(freeze(p2), 10u32);
        let _v1 = perp_market::take_ready_price_based_orders(p0, p1, _v0);
        p1 = 0;
        loop {
            let _v2 = vector::length<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>>(&_v1);
            if (!(p1 < _v2)) break;
            work_unit_utils::consume_order_placement_work_units(p2);
            let (_v3,_v4) = single_order_types::destroy_single_order<perp_engine_types::OrderMetadata>(*vector::borrow<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>>(&_v1, p1));
            let (_v5,_v6,_v7,_v8,_v9,_v10,_v11,_v12,_v13,_v14,_v15) = single_order_types::destroy_single_order_request<perp_engine_types::OrderMetadata>(_v3);
            let _v16 = _v15;
            let _v17 = _v11;
            let _v18 = perp_order::new_order_common_args(_v8, _v9, _v17, _v13, _v7);
            let _v19 = option::some<order_book_types::OrderId>(_v6);
            let _v20 = perp_engine_types::is_reduce_only(&_v16);
            let _v21 = option::none<u64>();
            let _v22 = perp_order::new_empty_order_tp_sl_args();
            let _v23 = perp_engine_types::get_builder_code_from_metadata(&_v16);
            _v17 = _v20;
            let _v24 = place_maker_or_queue_taker(p0, _v5, _v18, _v19, _v17, _v21, _v22, _v23);
            p1 = p1 + 1;
            continue
        };
    }
    friend fun trigger_twap_orders(p0: object::Object<perp_market::PerpMarket>, p1: &mut work_unit_utils::WorkUnit)
        acquires AsyncMatchingEngine
    {
        let _v0 = perp_market::take_ready_time_based_orders(p0, 10u32);
        let _v1 = 0;
        loop {
            let _v2 = vector::length<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>>(&_v0);
            if (!(_v1 < _v2)) break;
            work_unit_utils::consume_small_work_units(p1);
            let (_v3,_v4) = single_order_types::destroy_single_order<perp_engine_types::OrderMetadata>(*vector::borrow<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>>(&_v0, _v1));
            let (_v5,_v6,_v7,_v8,_v9,_v10,_v11,_v12,_v13,_v14,_v15) = single_order_types::destroy_single_order_request<perp_engine_types::OrderMetadata>(_v3);
            let _v16 = _v15;
            let (_v17,_v18,_v19) = perp_engine_types::get_twap_from_metadata(&_v16);
            let _v20 = option::none<u64>();
            let _v21 = perp_engine_types::is_reduce_only(&_v16);
            let _v22 = perp_engine_types::get_builder_code_from_metadata(&_v16);
            let _v23 = PendingTwap{account: _v5, order_id: _v6, is_buy: _v11, orig_size: _v9, instance_remaining_size: _v20, remaining_size: _v10, is_reduce_only: _v21, twap_start_time_s: _v17, twap_frequency_s: _v18, twap_end_time_s: _v19, builder_code: _v22, client_order_id: _v7};
            let _v24 = decibel_time::now_microseconds() + 1;
            let _v25 = transaction_context::monotonically_increasing_counter();
            let _v26 = PendingRequestKey::V1{time: _v24, priority: 2u8, tie_breaker: _v25};
            let _v27 = p0;
            let _v28 = object::object_address<perp_market::PerpMarket>(&_v27);
            let _v29 = &mut borrow_global_mut<AsyncMatchingEngine>(_v28).pending_requests;
            let _v30 = PendingRequest::Twap{_0: _v23};
            big_ordered_map::add<PendingRequestKey,PendingRequest>(_v29, _v26, _v30);
            _v1 = _v1 + 1;
            continue
        };
    }
    public fun view_first_n_margin_call_liquidations(p0: object::Object<perp_market::PerpMarket>, p1: u64): (vector<address>, vector<bool>)
        acquires AsyncMatchingEngine
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        if (!exists<AsyncMatchingEngine>(_v0)) {
            let _v1 = vector::empty<address>();
            let _v2 = vector::empty<bool>();
            return (_v1, _v2)
        };
        let (_v3,_v4) = get_first_n_from_address_queue(&borrow_global<AsyncMatchingEngine>(_v0).margin_call_liquidations_in_queue, p1);
        (_v3, _v4)
    }
    public fun view_first_n_pending_liquidations(p0: object::Object<perp_market::PerpMarket>, p1: u64): (vector<address>, vector<bool>)
        acquires AsyncMatchingEngine
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        if (!exists<AsyncMatchingEngine>(_v0)) {
            let _v1 = vector::empty<address>();
            let _v2 = vector::empty<bool>();
            return (_v1, _v2)
        };
        let (_v3,_v4) = get_first_n_from_address_queue(&borrow_global<AsyncMatchingEngine>(_v0).pending_liquidations_in_queue, p1);
        (_v3, _v4)
    }
    public fun view_first_n_pending_requests(p0: object::Object<perp_market::PerpMarket>, p1: u64): (vector<PendingRequestKey>, vector<PendingRequestView>)
        acquires AsyncMatchingEngine
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = vector::empty<PendingRequestKey>();
        let _v2 = vector::empty<PendingRequestView>();
        let _v3 = exists<AsyncMatchingEngine>(_v0);
        'l0: loop {
            if (_v3) {
                let _v4 = &borrow_global<AsyncMatchingEngine>(_v0).pending_requests;
                let _v5 = big_ordered_map::internal_new_begin_iter<PendingRequestKey,PendingRequest>(_v4);
                let _v6 = 0;
                loop {
                    let _v7;
                    if (big_ordered_map::iter_is_end<PendingRequestKey,PendingRequest>(&_v5, _v4)) _v7 = false else _v7 = _v6 < p1;
                    if (!_v7) break 'l0;
                    let _v8 = *big_ordered_map::iter_borrow_key<PendingRequestKey>(&_v5);
                    let _v9 = big_ordered_map::iter_borrow<PendingRequestKey,PendingRequest>(_v5, _v4);
                    vector::push_back<PendingRequestKey>(&mut _v1, _v8);
                    let _v10 = &mut _v2;
                    let _v11 = pending_request_to_view(_v9);
                    vector::push_back<PendingRequestView>(_v10, _v11);
                    _v5 = big_ordered_map::iter_next<PendingRequestKey,PendingRequest>(_v5, _v4);
                    _v6 = _v6 + 1;
                    continue
                }
            };
            return (_v1, _v2)
        };
        (_v1, _v2)
    }
    public fun view_margin_call_liquidations_length(p0: object::Object<perp_market::PerpMarket>): u64
        acquires AsyncMatchingEngine
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        if (!exists<AsyncMatchingEngine>(_v0)) return 0;
        big_ordered_map::compute_length<address,bool>(&borrow_global<AsyncMatchingEngine>(_v0).margin_call_liquidations_in_queue)
    }
    public fun view_nth_margin_call_liquidation(p0: object::Object<perp_market::PerpMarket>, p1: u64): (option::Option<address>, option::Option<bool>)
        acquires AsyncMatchingEngine
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        if (!exists<AsyncMatchingEngine>(_v0)) {
            let _v1 = option::none<address>();
            let _v2 = option::none<bool>();
            return (_v1, _v2)
        };
        let (_v3,_v4) = get_nth_from_address_queue(&borrow_global<AsyncMatchingEngine>(_v0).margin_call_liquidations_in_queue, p1);
        (_v3, _v4)
    }
    public fun view_nth_pending_liquidation(p0: object::Object<perp_market::PerpMarket>, p1: u64): (option::Option<address>, option::Option<bool>)
        acquires AsyncMatchingEngine
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        if (!exists<AsyncMatchingEngine>(_v0)) {
            let _v1 = option::none<address>();
            let _v2 = option::none<bool>();
            return (_v1, _v2)
        };
        let (_v3,_v4) = get_nth_from_address_queue(&borrow_global<AsyncMatchingEngine>(_v0).pending_liquidations_in_queue, p1);
        (_v3, _v4)
    }
    public fun view_nth_pending_request(p0: object::Object<perp_market::PerpMarket>, p1: u64): (option::Option<PendingRequestKey>, option::Option<PendingRequestView>)
        acquires AsyncMatchingEngine
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = exists<AsyncMatchingEngine>(_v0);
        'l0: loop {
            let _v2;
            let _v3;
            'l1: loop {
                if (_v1) {
                    _v3 = &borrow_global<AsyncMatchingEngine>(_v0).pending_requests;
                    _v2 = big_ordered_map::internal_new_begin_iter<PendingRequestKey,PendingRequest>(_v3);
                    let _v4 = 0;
                    loop {
                        if (big_ordered_map::iter_is_end<PendingRequestKey,PendingRequest>(&_v2, _v3)) break 'l0;
                        if (_v4 == p1) break 'l1;
                        _v2 = big_ordered_map::iter_next<PendingRequestKey,PendingRequest>(_v2, _v3);
                        _v4 = _v4 + 1
                    }
                };
                let _v5 = option::none<PendingRequestKey>();
                let _v6 = option::none<PendingRequestView>();
                return (_v5, _v6)
            };
            let _v7 = *big_ordered_map::iter_borrow_key<PendingRequestKey>(&_v2);
            let _v8 = big_ordered_map::iter_borrow<PendingRequestKey,PendingRequest>(_v2, _v3);
            let _v9 = option::some<PendingRequestKey>(_v7);
            let _v10 = option::some<PendingRequestView>(pending_request_to_view(_v8));
            return (_v9, _v10)
        };
        let _v11 = option::none<PendingRequestKey>();
        let _v12 = option::none<PendingRequestView>();
        (_v11, _v12)
    }
    public fun view_pending_liquidations_length(p0: object::Object<perp_market::PerpMarket>): u64
        acquires AsyncMatchingEngine
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        if (!exists<AsyncMatchingEngine>(_v0)) return 0;
        big_ordered_map::compute_length<address,bool>(&borrow_global<AsyncMatchingEngine>(_v0).pending_liquidations_in_queue)
    }
    public fun view_pending_requests_length(p0: object::Object<perp_market::PerpMarket>): u64
        acquires AsyncMatchingEngine
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        if (!exists<AsyncMatchingEngine>(_v0)) return 0;
        big_ordered_map::compute_length<PendingRequestKey,PendingRequest>(&borrow_global<AsyncMatchingEngine>(_v0).pending_requests)
    }
}
